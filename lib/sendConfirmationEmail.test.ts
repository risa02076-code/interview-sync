import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendConfirmationEmail } from "./sendConfirmationEmail";
import { sendEmail } from "./email";

vi.mock("./email", () => ({ sendEmail: vi.fn() }));

/**
 * sendConfirmationEmail이 실제로 두는 supabase 호출 체인만 지원하는 최소 가짜 클라이언트.
 * .select()/.eq()는 체이닝을 위해 this를 반환하고, .in()/.single()이 실제 데이터를 반환한다.
 */
function fakeSupabase({ panelInterviewers = [] as { name: string; email: string | null }[] } = {}) {
  const updateCalls: { table: string; payload: Record<string, unknown> }[] = [];

  const table = (name: string) => ({
    select() {
      return this;
    },
    eq() {
      return this;
    },
    single: async () => ({ data: null }),
    in: async () => ({ data: panelInterviewers }),
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
  matched_slot: "2026-08-14T00:00:00.000Z",
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
    expect(updateCalls.some((c) => "confirmation_sent_at" in c.payload)).toBe(false);
  });

  it("발송에 성공하면 confirmation_sent_at을 설정하고 실패 note는 남기지 않는다", async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce(undefined);
    const { client, updateCalls } = fakeSupabase();

    const result = await sendConfirmationEmail(client, baseInterview);

    expect(result.ok).toBe(true);
    expect(updateCalls.some((c) => "confirmation_sent_at" in c.payload)).toBe(true);
    expect(updateCalls.some((c) => "note" in c.payload)).toBe(false);
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
});
