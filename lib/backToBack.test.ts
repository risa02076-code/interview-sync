import { describe, it, expect } from "vitest";
import { findNoRestBefore } from "./backToBack";

const NINE_30 = "2024-01-02T00:30:00.000Z"; // 9:30 KST
const TEN = "2024-01-02T01:00:00.000Z"; // 10:00 KST — NINE_30 바로 다음 슬롯

describe("findNoRestBefore", () => {
  it("직전 슬롯이 비어 있으면 아무도 걸리지 않는다", () => {
    const panel = [{ id: "p1", name: "배지훈", busy_slots: [] }];
    expect(findNoRestBefore(panel, TEN)).toEqual([]);
  });

  it("직전 슬롯이 막혀 있는 면접관만 걸린다", () => {
    const panel = [
      { id: "p1", name: "배지훈", busy_slots: [NINE_30] },
      { id: "p2", name: "오세훈", busy_slots: [] },
    ];
    expect(findNoRestBefore(panel, TEN)).toEqual([{ id: "p1", name: "배지훈", busy_slots: [NINE_30] }]);
  });

  it("직전이 아니라 그 이전 슬롯이 막힌 것은 걸리지 않는다(여유가 있는 경우)", () => {
    const twoSlotsBefore = "2024-01-02T00:00:00.000Z"; // 9:00 KST
    const panel = [{ id: "p1", name: "배지훈", busy_slots: [twoSlotsBefore] }];
    expect(findNoRestBefore(panel, TEN)).toEqual([]);
  });

  it("여러 면접관이 동시에 걸릴 수 있다", () => {
    const panel = [
      { id: "p1", name: "배지훈", busy_slots: [NINE_30] },
      { id: "p2", name: "오세훈", busy_slots: [NINE_30] },
    ];
    expect(findNoRestBefore(panel, TEN)).toHaveLength(2);
  });
});
