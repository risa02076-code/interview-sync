import { describe, it, expect, vi, beforeEach } from "vitest";
import { requestPriorityConfirmation } from "./requestPriorityConfirmation";
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
    client: { from: (name: string) => table(name) } as unknown as Parameters<typeof requestPriorityConfirmation>[0],
    updateCalls,
  };
}

const interview = {
  id: "iv-1",
  candidate_name: "이하은",
  position: "디자이너",
  panel: ["a", "b"],
  preferred_slots: ["2026-08-21T00:00:00.000Z"],
};

describe("requestPriorityConfirmation", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset();
  });

  it("발송 실패자는 sent 카운트에서 빠지고 note에 남는다", async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("SMTP 실패"));
    const { client, updateCalls } = fakeSupabase([
      { id: "a", name: "오세훈", email: "a@example.com" },
      { id: "b", name: "배지훈", email: "b@example.com" },
    ]);

    const result = await requestPriorityConfirmation(client, interview, "http://localhost:3000");

    expect(result).toEqual({ ok: false, error: expect.stringContaining("배지훈") });
    const noteUpdate = updateCalls.find((c) => "note" in c.payload);
    expect(noteUpdate?.payload.note).toContain("배지훈");
    expect(noteUpdate?.payload.note).toContain("SMTP 실패");
  });

  it("이메일이 없는 면접관은 건너뛰고 sent 카운트에 포함하지 않는다", async () => {
    vi.mocked(sendEmail).mockResolvedValue(undefined);
    const { client, updateCalls } = fakeSupabase([
      { id: "a", name: "오세훈", email: "a@example.com" },
      { id: "b", name: "배지훈", email: null },
    ]);

    const result = await requestPriorityConfirmation(client, interview, "http://localhost:3000");

    expect(result).toEqual({ ok: true, sent: 1 });
    expect(updateCalls.some((c) => "email_sent_at" in c.payload)).toBe(true);
  });
});
