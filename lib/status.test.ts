import { describe, it, expect } from "vitest";
import { dDayLabel, deriveDisplayStatus } from "./status";

const base = {
  status: "pending" as const,
  stage: "created" as const,
  matched_slot: null as string | null,
  confirmation_sent_at: null as string | null,
};

describe("deriveDisplayStatus", () => {
  it("escalated면 stage와 무관하게 항상 재조율 필요로 표시한다", () => {
    expect(deriveDisplayStatus({ ...base, status: "escalated", stage: "candidate_done" })).toBe(
      "needs_reschedule",
    );
  });

  it.each([
    ["created", "awaiting_interviewer"],
    ["interviewer_pending", "awaiting_interviewer"],
    ["interviewer_done", "awaiting_candidate"],
    ["candidate_pending", "awaiting_candidate"],
    ["candidate_done", "awaiting_recruiter_pick"],
    ["priority_confirm_pending", "awaiting_priority_confirm"],
  ] as const)("status=pending, stage=%s → %s", (stage, expected) => {
    expect(deriveDisplayStatus({ ...base, status: "pending", stage })).toBe(expected);
  });

  it("confirmed고 확정 메일을 아직 안 보냈으면 조율 완료로 표시한다", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      deriveDisplayStatus({ ...base, status: "confirmed", matched_slot: future, confirmation_sent_at: null }),
    ).toBe("coordinated");
  });

  it("confirmed고 확정 메일을 보냈으면 확정으로 표시한다", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      deriveDisplayStatus({
        ...base,
        status: "confirmed",
        matched_slot: future,
        confirmation_sent_at: new Date().toISOString(),
      }),
    ).toBe("confirmed");
  });

  it("확정된 시간이 이미 지났으면 면접 종료로 표시한다", () => {
    const past = new Date(Date.now() - 86_400_000).toISOString();
    expect(
      deriveDisplayStatus({
        ...base,
        status: "confirmed",
        matched_slot: past,
        confirmation_sent_at: new Date().toISOString(),
      }),
    ).toBe("completed");
  });

  it("rescheduled도 confirmed와 동일한 규칙을 따른다", () => {
    const future = new Date(Date.now() + 86_400_000).toISOString();
    expect(
      deriveDisplayStatus({ ...base, status: "rescheduled", matched_slot: future, confirmation_sent_at: null }),
    ).toBe("coordinated");
  });
});

describe("dDayLabel", () => {
  // 시간대를 명시한 Z 문자열만 쓴다 — 실행 환경이 KST든 UTC든 같은 답이 나와야 한다.
  // 2024-01-02T00:00:00Z = 한국 1/2(화) 09:00
  const KST_JAN2_MORNING = "2024-01-02T00:00:00.000Z";

  it("같은 한국 날짜면 D-0이다", () => {
    // now가 UTC로는 1/1 23:00이지만 한국으로는 이미 1/2 08:00 — 같은 날이다.
    expect(dDayLabel(KST_JAN2_MORNING, new Date("2024-01-01T23:00:00.000Z"))).toBe("D-0");
  });

  it("한국 날짜로 사흘 뒤면 D-3이다", () => {
    expect(dDayLabel("2024-01-05T00:00:00.000Z", new Date(KST_JAN2_MORNING))).toBe("D-3");
  });

  it("한국 날짜가 지났으면 종료로 표시한다", () => {
    expect(dDayLabel("2024-01-01T00:00:00.000Z", new Date(KST_JAN2_MORNING))).toBe("종료");
  });

  it("매칭 전이면 null이다", () => {
    expect(dDayLabel(null)).toBeNull();
  });
});
