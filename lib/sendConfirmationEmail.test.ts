import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendConfirmationEmail } from "./sendConfirmationEmail";
import { sendEmail } from "./email";
import { formatSlotLabel } from "./slots";

vi.mock("./email", () => ({
  sendEmail: vi.fn(),
  emailErrorReason: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

/**
 * sendConfirmationEmail이 실제로 두는 supabase 호출 체인만 지원하는 최소 가짜 클라이언트.
 * .select()/.eq()는 체이닝을 위해 this를 반환하고, .in()/.single()이 실제 데이터를 반환한다.
 */
function fakeSupabase({
  panelInterviewers = [] as { name: string; email: string | null }[],
  sameSlotInterviews = [] as Record<string, unknown>[],
} = {}) {
  const updateCalls: { table: string; payload: Record<string, unknown> }[] = [];

  const table = (name: string) => ({
    select() {
      return this;
    },
    eq() {
      return this;
    },
    single: async () => ({ data: null }),
    // 정합성 검사는 "겹칠 수 있는 시간 창"으로 조회하므로 .gte()/.lte()도 체이닝된다.
    gte() {
      return this;
    },
    lte() {
      return this;
    },
    // interviewers 테이블에서는 .in()이 그대로 종료 호출(면접관 목록 조회)이고,
    // interviews 테이블에서는 뒤에 .neq()가 이어지는 체이닝(정합성 검사용 조회)이다.
    in() {
      if (name === "interviewers") return Promise.resolve({ data: panelInterviewers });
      return this;
    },
    neq: async () => ({ data: sameSlotInterviews, error: null }),
    insert: async () => ({ data: null, error: null }),
    update(payload: Record<string, unknown>) {
      updateCalls.push({ table: name, payload });
      return { eq: async () => ({ data: null, error: null }) };
    },
  });

  return {
    client: { from: (name: string) => table(name) } as unknown as Parameters<typeof sendConfirmationEmail>[0],
    updateCalls,
  };
}

const baseInterview = {
  id: "iv-1",
  candidate_name: "이하은",
  candidate_email: "candidate@example.com",
  position: "디자이너",
  panel: [],
  // 실행 시점과 무관하게 항상 "미래"로 남도록 충분히 먼 날짜를 쓴다 — 그래야
  // "과거인데 미발송" 규칙(checkConsistency.ts)이 다른 규칙을 테스트하는
  // 케이스들에 우연히 걸리지 않는다.
  matched_slot: "2099-01-01T00:00:00.000Z",
  room_id: null,
  interview_type: "온라인",
  status: "confirmed" as const,
  confirmation_sent_at: null,
};

describe("sendConfirmationEmail", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset();
  });

  it("발송에 실패하면 note에 실패 사실을 남기고 confirmation_sent_at을 설정하지 않는다", async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("SMTP 연결 실패"));
    const { client, updateCalls } = fakeSupabase();

    const result = await sendConfirmationEmail(client, baseInterview);

    expect(result.ok).toBe(false);
    const noteUpdate = updateCalls.find((c) => "note" in c.payload);
    expect(noteUpdate?.payload.note).toContain("발송 실패");
    expect(noteUpdate?.payload.note).toContain("candidate@example.com");
    expect(noteUpdate?.payload.note).toContain("SMTP 연결 실패");
    expect(updateCalls.some((c) => "confirmation_sent_at" in c.payload)).toBe(false);
  });

  it("발송에 성공하면 confirmation_sent_at을 설정하고 실패 note는 남기지 않는다", async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce(undefined);
    const { client, updateCalls } = fakeSupabase();

    const result = await sendConfirmationEmail(client, baseInterview);

    expect(result.ok).toBe(true);
    expect(updateCalls.some((c) => "confirmation_sent_at" in c.payload)).toBe(true);
    expect(updateCalls.some((c) => "note" in c.payload)).toBe(false);

    // 확정 메일에 실제로 맞는 후보자 이름·시간이 들어갔는지 확인한다 — 가장 위험한
    // 메일이라 발송 성공 여부만이 아니라 내용도 틀리면 안 된다.
    const [to, subject, html] = vi.mocked(sendEmail).mock.calls[0];
    expect(to).toBe(baseInterview.candidate_email);
    expect(subject).toContain(baseInterview.candidate_name);
    expect(html).toContain(formatSlotLabel(baseInterview.matched_slot));
    expect(html).toContain(baseInterview.interview_type);
  });

  it("이미 확정 메일을 보낸 케이스는 재발송하지 않는다", async () => {
    const { client } = fakeSupabase();
    const result = await sendConfirmationEmail(client, {
      ...baseInterview,
      confirmation_sent_at: "2026-08-01T00:00:00.000Z",
    });
    expect(result.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("같은 시간에 같은 면접관이 배정된 다른 확정 건이 있으면 발송을 보류하고 note를 남긴다", async () => {
    const interview = { ...baseInterview, panel: ["p1"] };
    const { client, updateCalls } = fakeSupabase({
      sameSlotInterviews: [
        {
          id: "iv-2",
          candidate_name: "다른후보",
          interview_type: "온라인",
          panel: ["p1"],
          matched_slot: interview.matched_slot,
          room_id: null,
          status: "confirmed",
        },
      ],
    });

    const result = await sendConfirmationEmail(client, interview);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("정합성 오류");
    // 화면이 "그냥 실패"와 구분해 강제 발송 버튼을 띄울 수 있어야 한다.
    if (!result.ok) expect(result.held).toBe(true);
    expect(sendEmail).not.toHaveBeenCalled();
    const noteUpdate = updateCalls.find((c) => "note" in c.payload);
    expect(noteUpdate?.payload.note).toContain("정합성 오류");
  });

  it("정합성 보류가 아닌 실패에는 held를 세우지 않는다", async () => {
    const { client } = fakeSupabase();

    // 이미 발송한 건은 정합성과 무관한 거절이라, 강제 발송으로 풀 수 있는 상태가 아니다.
    const result = await sendConfirmationEmail(client, {
      ...baseInterview,
      confirmation_sent_at: "2024-01-01T00:00:00.000Z",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.held).toBeUndefined();
      expect(result.error).toContain("이미 확정 메일을 발송했습니다");
    }
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it("면접관들에게도 각각 확정 메일이 발송된다", async () => {
    vi.mocked(sendEmail).mockResolvedValue(undefined);
    const interview = { ...baseInterview, panel: ["p1", "p2"] };
    const { client } = fakeSupabase({
      panelInterviewers: [
        { name: "면접관1", email: "int1@example.com" },
        { name: "면접관2", email: "int2@example.com" },
      ],
    });

    const result = await sendConfirmationEmail(client, interview);

    expect(result.ok).toBe(true);
    const calls = vi.mocked(sendEmail).mock.calls;
    // 후보자 1건 + 면접관 2건 = 총 3건이 나가야 한다
    expect(calls).toHaveLength(3);
    const recipients = calls.map(([to]) => to);
    expect(recipients).toContain("int1@example.com");
    expect(recipients).toContain("int2@example.com");

    const interviewerCall = calls.find(([to]) => to === "int1@example.com");
    expect(interviewerCall?.[2]).toContain(interview.candidate_name);
    expect(interviewerCall?.[2]).toContain(formatSlotLabel(interview.matched_slot));
  });

  it("면접관 중 한 명이라도 발송 실패하면 실패로 처리하고 note에 남긴다", async () => {
    vi.mocked(sendEmail)
      .mockResolvedValueOnce(undefined) // 후보자 발송 성공
      .mockRejectedValueOnce(new Error("면접관 메일 실패")); // 면접관 발송 실패
    const interview = { ...baseInterview, panel: ["p1"] };
    const { client, updateCalls } = fakeSupabase({
      panelInterviewers: [{ name: "면접관1", email: "int1@example.com" }],
    });

    const result = await sendConfirmationEmail(client, interview);

    expect(result.ok).toBe(false);
    const noteUpdate = updateCalls.find((c) => "note" in c.payload);
    expect(noteUpdate?.payload.note).toContain("int1@example.com");
    expect(updateCalls.some((c) => "confirmation_sent_at" in c.payload)).toBe(false);
  });

  it("origin이 주어지면 일정 변경 링크가 후보자 메일 본문에 들어간다", async () => {
    vi.mocked(sendEmail).mockResolvedValue(undefined);
    const { client } = fakeSupabase();

    await sendConfirmationEmail(client, baseInterview, "https://example.com");

    const [, , html] = vi.mocked(sendEmail).mock.calls[0];
    expect(html).toContain("https://example.com/respond/");
    expect(html).toContain("일정 변경");
  });

  it("origin이 없으면 일정 변경 링크를 넣지 않는다", async () => {
    vi.mocked(sendEmail).mockResolvedValue(undefined);
    const { client } = fakeSupabase();

    await sendConfirmationEmail(client, baseInterview);

    const [, , html] = vi.mocked(sendEmail).mock.calls[0];
    expect(html).not.toContain("일정 변경");
  });

  it("force:true로 넘기면 정합성 오류가 있어도 그대로 발송한다", async () => {
    const interview = { ...baseInterview, panel: ["p1"] };
    vi.mocked(sendEmail).mockResolvedValueOnce(undefined);
    const { client } = fakeSupabase({
      sameSlotInterviews: [
        {
          id: "iv-2",
          candidate_name: "다른후보",
          interview_type: "온라인",
          panel: ["p1"],
          matched_slot: interview.matched_slot,
          room_id: null,
          status: "confirmed",
        },
      ],
    });

    const result = await sendConfirmationEmail(client, interview, undefined, { force: true });

    expect(result.ok).toBe(true);
    expect(sendEmail).toHaveBeenCalled();
  });
});
