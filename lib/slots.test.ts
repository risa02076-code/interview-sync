import { describe, it, expect } from "vitest";
import { generateUpcomingSlots, formatSlotLabel } from "./slots";

// 2024-01-01은 월요일이라 영업일 계산 기준으로 삼기 좋다.
const MONDAY = new Date("2024-01-01T00:00:00");

describe("generateUpcomingSlots", () => {
  it("내일부터 시작해서 주말을 건너뛰고 영업일만 생성한다", () => {
    const slots = generateUpcomingSlots(5, 9, 18, 30, MONDAY);
    const days = [...new Set(slots.map((s) => s.key.slice(0, 10)))];
    // 1/1(월) 기준 내일은 1/2(화) → 화수목금 + 주말(1/6,1/7) 건너뛰고 다음 월요일(1/8)까지 5일
    expect(days).toEqual(["2024-01-02", "2024-01-03", "2024-01-04", "2024-01-05", "2024-01-08"]);
  });

  it("하루당 (종료-시작)*60/step 개의 슬롯을 만든다", () => {
    const slots = generateUpcomingSlots(1, 9, 18, 30, MONDAY);
    // 09:00~18:00, 30분 단위 = 18개
    expect(slots).toHaveLength(18);
    expect(slots[0].key).toContain("T00:00:00"); // 로컬 09:00 → UTC 오프셋 반영 전 자정 기준 문자열 앞부분만 확인
  });

  it("businessDays가 커지면 그만큼 영업일이 늘어난다", () => {
    const slots = generateUpcomingSlots(10, 9, 18, 30, MONDAY);
    const days = new Set(slots.map((s) => s.key.slice(0, 10)));
    expect(days.size).toBe(10);
  });
});

describe("formatSlotLabel", () => {
  it("월/일(요일) 시:분 형식으로 보여준다", () => {
    const dt = new Date(2024, 0, 2, 9, 30); // 2024-01-02 09:30, 화요일
    expect(formatSlotLabel(dt.toISOString())).toBe("1/2(화) 09:30");
  });
});
