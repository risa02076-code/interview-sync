import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendCandidateInvite } from "./sendCandidateInvite";
import { sendEmail } from "./email";

vi.mock("./email", () => ({ sendEmail: vi.fn() }));

type Row = { table: string; payload: Record<string, unknown> };

function fakeSupabase(panelInterviewers: { id: string; name: string; busy_slots: string[] }[]) {
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
    client: { from: (name: string) => table(name) } as unknown as Parameters<typeof sendCandidateInvite>[0],
    updateCalls,
  };
}

const interview = {
  id: "iv-1",
  candidate_name: "이하은",
  candidate_email: "candidate@example.com",
  position: "디자이너",
  panel: ["a"],
  interview_type: "온라인",
  excluded_slots: [] as string[],
};

describe("sendCandidateInvite", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset();
  });

  it("발송에 실패하면 stage/recommended_slots는 건드리지 않고 note만 남긴다", async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("SMTP 실패"));
    const { client, updateCalls } = fakeSupabase([{ id: "a", name: "오세훈", busy_slots: [] }]);

    const result = await sendCandidateInvite(client, interview, "http://localhost:3000");

    expect(result.ok).toBe(false);
    const noteUpdate = updateCalls.find((c) => "note" in c.payload);
    expect(noteUpdate?.payload.note).toContain("발송 실패");
    expect(updateCalls.some((c) => "stage" in c.payload)).toBe(false);
    expect(updateCalls.some((c) => "recommended_slots" in c.payload)).toBe(false);
    expect(updateCalls.some((c) => "email_sent_at" in c.payload)).toBe(false);
  });

  it("발송에 성공하면 stage를 candidate_pending으로 넘기고 recommended_slots를 저장한다", async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce(undefined);
    const { client, updateCalls } = fakeSupabase([{ id: "a", name: "오세훈", busy_slots: [] }]);

    const result = await sendCandidateInvite(client, interview, "http://localhost:3000");

    expect(result.ok).toBe(true);
    const stageUpdate = updateCalls.find((c) => "stage" in c.payload);
    expect(stageUpdate?.payload.stage).toBe("candidate_pending");
    expect(stageUpdate?.payload.recommended_slots).toBeDefined();
    expect(updateCalls.some((c) => "email_sent_at" in c.payload)).toBe(true);
  });

  it("후보자 이메일이 없으면 발송 시도 없이 바로 실패를 반환한다", async () => {
    const { client } = fakeSupabase([{ id: "a", name: "오세훈", busy_slots: [] }]);
    const result = await sendCandidateInvite(client, { ...interview, candidate_email: null }, "http://localhost:3000");
    expect(result.ok).toBe(false);
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
