import { describe, it, expect } from "vitest";
import { findMatch, recommendLeastConflictSlots, requiresRoom } from "./matching";
import { generateUpcomingSlots } from "./slots";

describe("requiresRoom", () => {
  it("대면 면접만 회의실이 필요하다", () => {
    expect(requiresRoom("1차 대면")).toBe(true);
    expect(requiresRoom("2차 대면")).toBe(true);
    expect(requiresRoom("온라인")).toBe(false);
    expect(requiresRoom("전화")).toBe(false);
  });
});

describe("findMatch (broaden=false, 후보자가 제출한 시간 안에서만 탐색)", () => {
  const A = "2024-01-02T00:00:00.000Z";
  const B = "2024-01-02T00:30:00.000Z";

  it("전원이 비어있는 첫 시간으로 확정한다", () => {
    const result = findMatch(
      [A, B],
      [{ id: "p1", name: "P1", role: "", busy_slots: [] }],
      [{ id: "r1", name: "R1", busy_slots: [] }],
      false,
      true,
    );
    expect(result.status).toBe("confirmed");
    expect(result.matchedSlot).toBe(A);
    expect(result.roomId).toBe("r1");
  });

  it("첫 시간에 면접관이 바쁘면 다음 시간으로 넘어간다", () => {
    const result = findMatch(
      [A, B],
      [{ id: "p1", name: "P1", role: "", busy_slots: [A] }],
      [{ id: "r1", name: "R1", busy_slots: [] }],
      false,
      true,
    );
    expect(result.matchedSlot).toBe(B);
  });

  it("회의실이 필요 없는 면접 유형은 회의실 없이도 확정된다", () => {
    const result = findMatch([A], [{ id: "p1", name: "P1", role: "", busy_slots: [] }], [], false, false);
    expect(result.status).toBe("confirmed");
    expect(result.roomId).toBeNull();
  });

  it("전원 공통 가능 시간이 없으면 escalated를 반환한다", () => {
    const result = findMatch(
      [A],
      [{ id: "p1", name: "P1", role: "", busy_slots: [A] }],
      [{ id: "r1", name: "R1", busy_slots: [] }],
      false,
      true,
    );
    expect(result.status).toBe("escalated");
    expect(result.matchedSlot).toBeNull();
  });

  it("후보자가 제출한 시간이 없으면 pending을 반환한다", () => {
    const result = findMatch([], [], [], false, true);
    expect(result.status).toBe("pending");
  });

  it("회의실이 전부 사용 중이면 그 시간은 건너뛴다", () => {
    const result = findMatch(
      [A, B],
      [{ id: "p1", name: "P1", role: "", busy_slots: [] }],
      [{ id: "r1", name: "R1", busy_slots: [A] }],
      false,
      true,
    );
    expect(result.matchedSlot).toBe(B);
  });
});

// recommendLeastConflictSlots는 내부적으로 generateUpcomingSlots(businessDays)를 "지금" 기준으로
// 호출해서, 테스트 시점과 무관하게 항상 맞는 슬롯 키를 쓰려면 같은 함수로 실제 후보 슬롯을 먼저
// 뽑아서 그중 하나를 busy_slots에 넣어야 한다(하드코딩된 과거 날짜는 절대 매칭되지 않는다).
describe("recommendLeastConflictSlots", () => {
  const upcoming = generateUpcomingSlots(5).map((s) => s.key);
  const targetSlot = upcoming[0];

  it("아무도 안 바쁘면 모든 슬롯이 충돌 0으로 개수 제한 없이 반환된다", () => {
    const recs = recommendLeastConflictSlots(
      [{ id: "p1", name: "P1", role: "", busy_slots: [] }],
      [],
      false,
      5,
    );
    expect(recs.length).toBe(upcoming.length);
    expect(recs.every((r) => r.conflicts.length === 0)).toBe(true);
  });

  it("전원 동시 가능 시간이 없으면 대안 슬롯의 conflicts에 이름이 담긴다", () => {
    // 0점(전원 가능) 슬롯이 하나도 없어야, 최소 충돌 슬롯이 "대안"으로 채택되어 conflicts가 채워진다.
    // (0점 슬롯이 있으면 그쪽만 반환되고 이 시간은 아예 목록에서 빠진다.)
    const recs = recommendLeastConflictSlots(
      [{ id: "p1", name: "오세훈", role: "", busy_slots: upcoming }],
      [],
      false,
      5,
    );
    expect(recs.length).toBeGreaterThan(0);
    expect(recs.every((r) => r.conflicts.includes("오세훈"))).toBe(true);
  });

  it("excludeSlots에 있는 시간은 추천 목록에서 아예 빠진다", () => {
    const recs = recommendLeastConflictSlots([], [], false, 5, [targetSlot]);
    expect(recs.some((r) => r.slot === targetSlot)).toBe(false);
  });

  it("전원 동시 가능 시간이 하나도 없으면 최대 3개까지만 대안으로 반환한다", () => {
    const bothBusyEveryDay = [
      { id: "p1", name: "P1", role: "", busy_slots: upcoming },
      { id: "p2", name: "P2", role: "", busy_slots: upcoming.slice(0, upcoming.length - 1) },
    ];
    const recs = recommendLeastConflictSlots(bothBusyEveryDay, [], false, 5);
    // 전부 충돌(1명 이상)이라 0점 슬롯이 없고, 최소 충돌(1명)인 슬롯들만 최대 3개
    expect(recs.every((r) => r.conflicts.length > 0)).toBe(true);
    expect(recs.length).toBeLessThanOrEqual(3);
  });
});
