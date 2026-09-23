import { describe, it, expect } from "vitest";
import { oracleFindMatch, type OracleInterviewer, type OracleRoom } from "./matching.oracle";

/**
 * matching.oracle.test.ts는 오라클을 원본(findMatch)과 대조한다 — 그런데 둘이
 * "같은 답"을 낸다는 것만으로는, 둘 다 PRD.md "7. 확정된 규칙 예시"를 똑같이
 * 잘못 해석했을 가능성("공유된 오해")을 배제하지 못한다. 이 파일은 findMatch를
 * 전혀 참조하지 않고, 오라클 하나만 PRD §7 예시 숫자에 직접 대조한다.
 */

const KST = (hour: number, minute = 0) => new Date(Date.UTC(2024, 0, 2, hour - 9, minute)).toISOString();

describe("oracleFindMatch 대 PRD §7 확정 예시 (오라클 단독 검증)", () => {
  it("§7-1: 대면(60분)은 두 번째 30분 슬롯도 비어 있어야 확정된다", () => {
    const secondSlot = KST(10, 30);
    const interviewers: OracleInterviewer[] = [{ id: "p1", busy_slots: [secondSlot] }];
    const rooms: OracleRoom[] = [{ id: "r1", busy_slots: [] }];

    const result = oracleFindMatch([KST(10, 0)], interviewers, rooms, "1차 대면", true);

    expect(result.matchedSlot).toBeNull();
  });

  it("§7-1: 온라인(30분)은 같은 상황에서 첫 슬롯만 비어 있으면 확정된다", () => {
    const secondSlot = KST(10, 30);
    const interviewers: OracleInterviewer[] = [{ id: "p1", busy_slots: [secondSlot] }];

    const result = oracleFindMatch([KST(10, 0)], interviewers, [], "온라인", false);

    expect(result.matchedSlot).toBe(KST(10, 0));
  });

  it("§7-2: 면접관 2명이면 정원 2인실은 부족해서 배정되지 않는다", () => {
    const interviewers: OracleInterviewer[] = [
      { id: "p1", busy_slots: [] },
      { id: "p2", busy_slots: [] },
    ];
    const rooms: OracleRoom[] = [{ id: "r1", busy_slots: [], capacity: 2 }];

    const result = oracleFindMatch([KST(10, 0)], interviewers, rooms, "온라인", true);

    expect(result.matchedSlot).toBeNull();
  });

  it("§7-2: 면접관 2명이면 정원 3인실부터 배정된다", () => {
    const interviewers: OracleInterviewer[] = [
      { id: "p1", busy_slots: [] },
      { id: "p2", busy_slots: [] },
    ];
    const rooms: OracleRoom[] = [{ id: "r1", busy_slots: [], capacity: 3 }];

    const result = oracleFindMatch([KST(10, 0)], interviewers, rooms, "온라인", true);

    expect(result.roomId).toBe("r1");
  });

  it("§7-2: 정원 미입력(null) 면접실은 인원과 무관하게 제한하지 않는다", () => {
    const interviewers: OracleInterviewer[] = [
      { id: "p1", busy_slots: [] },
      { id: "p2", busy_slots: [] },
      { id: "p3", busy_slots: [] },
    ];
    const rooms: OracleRoom[] = [{ id: "r1", busy_slots: [], capacity: null }];

    const result = oracleFindMatch([KST(10, 0)], interviewers, rooms, "온라인", true);

    expect(result.roomId).toBe("r1");
  });

  it("§7-3: 17:00 시작 대면(60분)은 정확히 18:00에 끝나 업무시간 안이다", () => {
    const result = oracleFindMatch([KST(17, 0)], [{ id: "p1", busy_slots: [] }], [], "1차 대면", false);

    expect(result.matchedSlot).toBe(KST(17, 0));
  });

  it("§7-3: 17:30 시작 대면(60분)은 18:30에 끝나 업무시간을 넘겨 배정되지 않는다", () => {
    const result = oracleFindMatch([KST(17, 30)], [{ id: "p1", busy_slots: [] }], [], "1차 대면", false);

    expect(result.matchedSlot).toBeNull();
  });
});
