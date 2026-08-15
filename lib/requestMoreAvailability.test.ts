import { describe, it, expect, vi, beforeEach } from "vitest";
import { requestMoreAvailability } from "./requestMoreAvailability";
import { sendEmail } from "./email";

vi.mock("./email", () => ({ sendEmail: vi.fn() }));

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
    client: { from: (name: string) => table(name) } as unknown as Parameters<typeof requestMoreAvailability>[0],
    updateCalls,
  };
}

const interview = { id: "iv-1", candidate_name: "이하은", position: "디자이너", panel: ["a", "b"] };

describe("requestMoreAvailability", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset();
  });

  it("실패자가 있으면 기존 재문의 안내 note 뒤에 실패 내용을 덧붙인다", async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("SMTP 실패"));
    const { client, updateCalls } = fakeSupabase([
      { id: "a", name: "오세훈", email: "a@example.com" },
      { id: "b", name: "배지훈", email: "b@example.com" },
    ]);

    const result = await requestMoreAvailability(client, interview, "http://localhost:3000", 2);

    expect(result.ok).toBe(false);
    const noteUpdate = updateCalls.find((c) => "note" in c.payload);
    expect(noteUpdate?.payload.note).toContain("영업일 10일");
    expect(noteUpdate?.payload.note).toContain("배지훈");
  });

  it("전원 성공하면 재문의 안내 note만 남고 실패 문구는 없다", async () => {
    vi.mocked(sendEmail).mockResolvedValue(undefined);
    const { client, updateCalls } = fakeSupabase([{ id: "a", name: "오세훈", email: "a@example.com" }]);

    const result = await requestMoreAvailability(client, interview, "http://localhost:3000", 1);

    expect(result).toEqual({ ok: true, sent: 1 });
    const noteUpdate = updateCalls.find((c) => "note" in c.payload);
    expect(noteUpdate?.payload.note).not.toContain("⚠️");
  });
});
