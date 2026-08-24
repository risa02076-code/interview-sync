import { describe, it, expect } from "vitest";
import { findConsistencyViolations, type ConsistencyCheckInterview } from "./checkConsistency";

const SLOT_A = "2024-01-02T00:00:00.000Z"; // 09:00 KST
const SLOT_B = "2024-01-02T00:30:00.000Z"; // 09:30 KST — 1시간 면접이면 SLOT_A와 겹친다
const SLOT_C = "2024-01-02T01:00:00.000Z"; // 10:00 KST — 1시간 면접이라도 SLOT_A와 겹치지 않는다
const SLOT_LATE = "2024-01-02T08:30:00.000Z"; // 17:30 KST — 1시간 면접이면 18:30에 끝난다

function base(overrides: Partial<ConsistencyCheckInterview>): ConsistencyCheckInterview {
  return {
    id: "iv1",
    candidate_name: "후보자1",
    interview_type: "1차 대면",
    panel: ["p1"],
    matched_slot: SLOT_A,
    room_id: "r1",
    status: "confirmed",
    // 기본값은 "이미 발송됨"으로 둬서, 다른 규칙을 테스트하는 케이스들이
    // (SLOT_A가 실행 시점 기준 과거라도) 아래 "과거인데 미발송" 규칙에
    // 우연히 걸리지 않게 한다. 그 규칙만 테스트하는 곳에서 명시적으로 null로 덮어쓴다.
    confirmation_sent_at: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("findConsistencyViolations", () => {
  it("정상적인 확정 건은 아무것도 잡지 않는다", () => {
    const violations = findConsistencyViolations([base({})]);
    expect(violations).toEqual([]);
  });

  it("같은 면접관이 겹치지 않는 다른 시간에 배정된 건 정상이라 잡지 않는다", () => {
    const violations = findConsistencyViolations([
      base({ id: "iv1", panel: ["p1"], matched_slot: SLOT_A, room_id: "r1" }),
      base({ id: "iv2", panel: ["p1"], matched_slot: SLOT_C, room_id: "r2" }),
    ]);
    expect(violations).toEqual([]);
  });

  it("1시간 면접 뒤 30분에 같은 면접관이 또 배정되면 겹침으로 잡는다", () => {
    const violations = findConsistencyViolations([
      base({ id: "iv1", candidate_name: "A", panel: ["p1"], matched_slot: SLOT_A, room_id: "r1" }),
      base({ id: "iv2", candidate_name: "B", panel: ["p1"], matched_slot: SLOT_B, room_id: "r2" }),
    ]);
    expect(violations).toHaveLength(2);
    expect(violations.every((v) => v.kind === "interviewer_double_booked")).toBe(true);
  });

  it("1시간 면접 뒤 30분에 같은 면접실이 또 쓰이면 겹침으로 잡는다", () => {
    const violations = findConsistencyViolations([
      base({ id: "iv1", candidate_name: "A", panel: ["p1"], matched_slot: SLOT_A, room_id: "r1" }),
      base({ id: "iv2", candidate_name: "B", panel: ["p2"], matched_slot: SLOT_B, room_id: "r1" }),
    ]);
    expect(violations.filter((v) => v.kind === "room_double_booked")).toHaveLength(2);
  });

  it("30분 면접(온라인)은 30분 뒤 면접과 겹치지 않는다", () => {
    const violations = findConsistencyViolations([
      base({ id: "iv1", interview_type: "온라인", panel: ["p1"], matched_slot: SLOT_A, room_id: null }),
      base({ id: "iv2", interview_type: "온라인", panel: ["p1"], matched_slot: SLOT_B, room_id: null }),
    ]);
    expect(violations).toEqual([]);
  });

  it("업무시간을 넘겨 끝나는 확정 건을 잡는다", () => {
    const violations = findConsistencyViolations([base({ matched_slot: SLOT_LATE })]);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("outside_business_hours");
  });

  it("확정(confirmed)인데 matched_slot이 없으면 잡는다", () => {
    const violations = findConsistencyViolations([base({ matched_slot: null })]);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("status_slot_mismatch");
  });

  it("확정 안 됐는데(pending) matched_slot이 남아있으면 잡는다", () => {
    const violations = findConsistencyViolations([base({ status: "pending", matched_slot: SLOT_A })]);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("status_slot_mismatch");
  });

  it("escalated 상태는 matched_slot이 없어야 정상이다", () => {
    const violations = findConsistencyViolations([base({ status: "escalated", matched_slot: null, room_id: null })]);
    expect(violations).toEqual([]);
  });

  it("대면 면접인데 면접실이 없으면 잡는다", () => {
    const violations = findConsistencyViolations([base({ interview_type: "1차 대면", room_id: null })]);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("missing_room");
  });

  it("비대면(온라인) 면접인데 면접실이 배정돼 있으면 잡는다", () => {
    const violations = findConsistencyViolations([base({ interview_type: "온라인", room_id: "r1" })]);
    expect(violations).toHaveLength(1);
    expect(violations[0].kind).toBe("unexpected_room");
  });

  it("비대면 면접이 면접실 없이 확정된 건 정상이다", () => {
    const violations = findConsistencyViolations([base({ interview_type: "전화", room_id: null })]);
    expect(violations).toEqual([]);
  });

  it("같은 면접관이 같은 시간에 두 면접에 배정되면 둘 다 잡는다", () => {
    const violations = findConsistencyViolations([
      base({ id: "iv1", candidate_name: "A", panel: ["p1"], room_id: "r1", matched_slot: SLOT_A }),
      base({ id: "iv2", candidate_name: "B", panel: ["p1"], room_id: "r2", matched_slot: SLOT_A }),
    ]);
    const doubled = violations.filter((v) => v.kind === "interviewer_double_booked");
    expect(doubled).toHaveLength(2);
    expect(doubled.map((v) => v.interviewId).sort()).toEqual(["iv1", "iv2"]);
  });

  it("같은 면접실이 같은 시간에 두 면접으로 잡히면 둘 다 잡는다", () => {
    const violations = findConsistencyViolations([
      base({ id: "iv1", candidate_name: "A", panel: ["p1"], room_id: "r1", matched_slot: SLOT_A }),
      base({ id: "iv2", candidate_name: "B", panel: ["p2"], room_id: "r1", matched_slot: SLOT_A }),
    ]);
    const doubled = violations.filter((v) => v.kind === "room_double_booked");
    expect(doubled).toHaveLength(2);
    expect(doubled.map((v) => v.interviewId).sort()).toEqual(["iv1", "iv2"]);
  });

  it("재조율(rescheduled)로 확정된 건도 이중 배정 검사 대상에 포함한다", () => {
    const violations = findConsistencyViolations([
      base({ id: "iv1", candidate_name: "A", panel: ["p1"], room_id: "r1", matched_slot: SLOT_A, status: "rescheduled" }),
      base({ id: "iv2", candidate_name: "B", panel: ["p1"], room_id: "r2", matched_slot: SLOT_A, status: "confirmed" }),
    ]);
    expect(violations.filter((v) => v.kind === "interviewer_double_booked")).toHaveLength(2);
  });

  describe("과거 시간인데 확정 메일이 발송되지 않은 경우", () => {
    const AFTER_SLOT_A = new Date("2024-01-03T00:00:00.000Z");
    const BEFORE_SLOT_A = new Date("2024-01-01T00:00:00.000Z");

    it("확정 시간이 지났는데 발송 안 됐으면 잡는다", () => {
      const violations = findConsistencyViolations(
        [base({ confirmation_sent_at: null })],
        AFTER_SLOT_A,
      );
      expect(violations).toHaveLength(1);
      expect(violations[0].kind).toBe("unnotified_past_slot");
    });

    it("확정 시간이 지났지만 이미 발송됐으면 정상이다(끝난 면접일 뿐)", () => {
      const violations = findConsistencyViolations(
        [base({ confirmation_sent_at: "2024-01-01T00:00:00.000Z" })],
        AFTER_SLOT_A,
      );
      expect(violations).toEqual([]);
    });

    it("확정 시간이 아직 미래면, 발송 전이어도 정상이다", () => {
      const violations = findConsistencyViolations(
        [base({ confirmation_sent_at: null })],
        BEFORE_SLOT_A,
      );
      expect(violations).toEqual([]);
    });
  });
});
