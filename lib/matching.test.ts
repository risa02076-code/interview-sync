import { describe, it, expect } from "vitest";
import { findMatch, recommendLeastConflictSlots, requiresRoom } from "./matching";
import { generateUpcomingSlots } from "./slots";

describe("requiresRoom", () => {
  it("대면 면접만 면접실이 필요하다", () => {
    expect(requiresRoom("1차 대면")).toBe(true);
    expect(requiresRoom("2차 대면")).toBe(true);
    expect(requiresRoom("온라인")).toBe(false);
    expect(requiresRoom("전화")).toBe(false);
  });
});

describe("findMatch (broaden=false, 후보자가 제출한 시간 안에서만 탐색)", () => {
  const A = "2024-01-02T00:00:00.000Z";
  const B = "2024-01-02T00:30:00.000Z";

  const panelOf = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, role: "", busy_slots: [] }));

  it("정원이 모자란 방은 비어 있어도 고르지 않는다", () => {
    // 면접관 4명 면접에는 후보자를 포함해 5자리가 필요하다. 4인실은 후보자가
    // 앉을 자리가 없다.
    const result = findMatch(
      [A],
      panelOf(4),
      [{ id: "small", name: "2인실", busy_slots: [], capacity: 4 }],
      false,
      true,
    );
    expect(result.status).not.toBe("confirmed");
    expect(result.roomId).toBeNull();
  });

  it("정원이 모자란 방을 건너뛰고 들어가는 방을 고른다", () => {
    const result = findMatch(
      [A],
      panelOf(2),
      [
        { id: "small", name: "2인실", busy_slots: [], capacity: 2 },
        { id: "big", name: "6인실", busy_slots: [], capacity: 6 },
      ],
      false,
      true,
    );
    expect(result.status).toBe("confirmed");
    expect(result.roomId).toBe("big");
  });

  it("사용 안 함으로 표시된 방은 정원이 넉넉해도 고르지 않는다", () => {
    const result = findMatch(
      [A],
      panelOf(2),
      [
        { id: "off", name: "공사 중", busy_slots: [], capacity: 20, active: false },
        { id: "ok", name: "면접실 A", busy_slots: [], capacity: 4 },
      ],
      false,
      true,
    );
    expect(result.roomId).toBe("ok");
  });

  it("정원이 없는(미입력) 방은 종전대로 고를 수 있다", () => {
    // 값을 모르는 것과 "작다"는 것은 다르다. 모른다고 막으면 정원을 입력하기
    // 전까지 확정이 전부 멈춘다.
    const result = findMatch([A], panelOf(8), [{ id: "r1", name: "R1", busy_slots: [] }], false, true);
    expect(result.status).toBe("confirmed");
    expect(result.roomId).toBe("r1");
  });

  it("면접실이 필요 없는 유형은 정원과 무관하게 확정된다", () => {
    const result = findMatch(
      [A],
      panelOf(8),
      [{ id: "small", name: "2인실", busy_slots: [], capacity: 2 }],
      false,
      false,
    );
    expect(result.status).toBe("confirmed");
    expect(result.roomId).toBeNull();
  });

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

  it("면접실이 필요 없는 면접 유형은 면접실 없이도 확정된다", () => {
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

  it("면접실이 전부 사용 중이면 그 시간은 건너뛴다", () => {
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

describe("findMatch (소요시간이 여러 슬롯에 걸치는 경우)", () => {
  const NINE = "2024-01-02T00:00:00.000Z"; // 09:00 KST
  const NINE_THIRTY = "2024-01-02T00:30:00.000Z"; // 09:30 KST
  const TEN = "2024-01-02T01:00:00.000Z"; // 10:00 KST
  const FIVE_THIRTY_PM = "2024-01-02T08:30:00.000Z"; // 17:30 KST

  const free = (busy: string[] = []) => [{ id: "p1", name: "P1", role: "", busy_slots: busy }];
  const room = (busy: string[] = []) => [{ id: "r1", name: "R1", busy_slots: busy }];

  it("시작 슬롯은 비어 있어도 뒤 30분이 차 있으면 1시간 면접은 그 시간을 건너뛴다", () => {
    const result = findMatch([NINE, TEN], free([NINE_THIRTY]), room(), false, true, 60);
    expect(result.matchedSlot).toBe(TEN);
  });

  it("같은 상황에서 30분 면접이면 그 시간에 그대로 확정된다", () => {
    const result = findMatch([NINE, TEN], free([NINE_THIRTY]), room(), false, true, 30);
    expect(result.matchedSlot).toBe(NINE);
  });

  it("면접실도 면접 시간 전체가 비어 있어야 배정한다", () => {
    const result = findMatch([NINE, TEN], free(), room([NINE_THIRTY]), false, true, 60);
    expect(result.matchedSlot).toBe(TEN);
  });

  it("업무시간을 넘겨 끝나는 시작 시간은 후보에서 제외한다", () => {
    const result = findMatch([FIVE_THIRTY_PM], free(), room(), false, true, 60);
    expect(result.status).toBe("escalated");
    expect(result.matchedSlot).toBeNull();
  });

  it("같은 마지막 슬롯이라도 30분 면접이면 확정할 수 있다", () => {
    const result = findMatch([FIVE_THIRTY_PM], free(), room(), false, true, 30);
    expect(result.matchedSlot).toBe(FIVE_THIRTY_PM);
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
