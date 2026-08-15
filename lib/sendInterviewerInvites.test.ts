import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendInterviewerInvites } from "./sendInterviewerInvites";
import { sendEmail } from "./email";

vi.mock("./email", () => ({
  sendEmail: vi.fn(),
  emailErrorReason: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

type Row = { table: string; payload: Record<string, unknown> };

function fakeSupabase(panelInterviewers: { id: string; name: string; email: string | null }[]) {
  const updateCalls: Row[] = [];
  const table = (name: string) => ({
    select() {
      return this;
    },
    eq() {
      return this;
    },
    in: async () => ({ data: panelInterviewers, error: null }),
    insert: async () => ({ data: null, error: null }),
    update(payload: Record<string, unknown>) {
      updateCalls.push({ table: name, payload });
      return { eq: async () => ({ data: null, error: null }) };
    },
  });
  return {
    client: { from: (name: string) => table(name) } as unknown as Parameters<typeof sendInterviewerInvites>[0],
    updateCalls,
  };
}

const interview = { id: "iv-1", candidate_name: "이하은", position: "디자이너", panel: ["a", "b"] };

describe("sendInterviewerInvites", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset();
  });

  it("한 명 발송이 실패해도 나머지는 계속 보내고, note에 실패자만 남긴다", async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("SMTP 실패"));
    const { client, updateCalls } = fakeSupabase([
      { id: "a", name: "오세훈", email: "a@example.com" },
      { id: "b", name: "배지훈", email: "b@example.com" },
    ]);

    const result = await sendInterviewerInvites(client, interview, "http://localhost:3000");

    expect(sendEmail).toHaveBeenCalledTimes(2);
    expect(result.ok).toBe(false);
    const noteUpdate = updateCalls.find((c) => "note" in c.payload);
    expect(noteUpdate?.payload.note).toContain("배지훈");
    expect(noteUpdate?.payload.note).not.toContain("오세훈");
    // 실패 사유(SMTP 에러 메시지)도 그대로 노출되어야 채용담당자가 원인을 알 수 있다.
    expect(noteUpdate?.payload.note).toContain("SMTP 실패");
    expect(updateCalls.some((c) => c.payload.stage === "interviewer_pending")).toBe(true);
    // 발송에 성공한 사람 몫으로는 email_sent_at이 기록되어야, 실패한 사람과 화면에서 구분된다.
    expect(updateCalls.some((c) => "email_sent_at" in c.payload)).toBe(true);
  });

  it("전원 발송에 성공하면 note를 남기지 않는다", async () => {
    vi.mocked(sendEmail).mockResolvedValue(undefined);
    const { client, updateCalls } = fakeSupabase([{ id: "a", name: "오세훈", email: "a@example.com" }]);

    const result = await sendInterviewerInvites(client, interview, "http://localhost:3000");

    expect(result.ok).toBe(true);
    expect(updateCalls.some((c) => "note" in c.payload)).toBe(false);
    expect(updateCalls.some((c) => "email_sent_at" in c.payload)).toBe(true);

    // 발송 자체 성공만이 아니라, 실제로 맞는 사람에게 맞는 내용이 나갔는지도 검증한다.
    const [to, subject, html] = vi.mocked(sendEmail).mock.calls[0];
    expect(to).toBe("a@example.com");
    expect(subject).toContain(interview.candidate_name);
    expect(html).toContain(interview.candidate_name);
    expect(html).toContain("http://localhost:3000/respond/");
  });
});
