import { describe, it, expect } from "vitest";
import { generateUpcomingSlots, formatSlotLabel } from "./slots";

// 2024-01-01 00:00 KST = 2023-12-31T15:00:00Z. 타임존이 명시된(Z) 문자열을 써야
// 이 테스트가 어느 시간대에서 실행되든(로컬 개발 환경이든 UTC 서버든) 항상 같은
// 결과를 내는지 검증할 수 있다 — 오프셋 없는 문자열은 실행 환경의 로컬 시간대에
// 따라 다르게 해석돼서, 실제로 이 버그를 숨기고 있었다.
const MONDAY_KST_MIDNIGHT = new Date("2023-12-31T15:00:00Z");

describe("generateUpcomingSlots", () => {
  it("내일부터 시작해서 주말을 건너뛰고 영업일만 생성한다 (한국 날짜 기준)", () => {
    const slots = generateUpcomingSlots(5, 9, 18, 30, MONDAY_KST_MIDNIGHT);
    // 슬롯 키는 UTC라 그대로 slice하면 한국 날짜가 아니라 UTC 날짜가 나온다 —
    // 라벨(한국 시간 기준으로 변환됨)에서 날짜 부분을 뽑아 검증한다.
    const days = [...new Set(slots.map((s) => s.label.slice(0, s.label.indexOf("("))))];
    // 1/1(월) 기준 내일은 1/2(화) → 화수목금 + 주말(1/6,1/7) 건너뛰고 다음 월요일(1/8)까지 5일
    expect(days).toEqual(["1/2", "1/3", "1/4", "1/5", "1/8"]);
  });

  it("하루당 (종료-시작)*60/step 개의 슬롯을 만들고, 한국 시간 09:00부터 시작한다", () => {
    const slots = generateUpcomingSlots(1, 9, 18, 30, MONDAY_KST_MIDNIGHT);
    // 09:00~18:00, 30분 단위 = 18개
    expect(slots).toHaveLength(18);
    // 한국 시간 1/2(화) 09:00 = UTC 1/2 00:00
    expect(slots[0].key).toBe("2024-01-02T00:00:00.000Z");
    expect(slots[0].label).toBe("1/2(화) 09:00");
  });

  it("businessDays가 커지면 그만큼 영업일이 늘어난다", () => {
    const slots = generateUpcomingSlots(10, 9, 18, 30, MONDAY_KST_MIDNIGHT);
    const days = new Set(slots.map((s) => s.label.slice(0, s.label.indexOf("("))));
    expect(days.size).toBe(10);
  });

  it("실행 환경의 로컬 시간대와 무관하게 항상 같은 결과를 낸다", () => {
    // from을 UTC 정오로 줘도(로컬 타임존이 뭐든 영향받지 않아야 함) 결과가 같아야 한다.
    const slotsA = generateUpcomingSlots(1, 9, 18, 30, new Date("2023-12-31T15:00:00Z"));
    const slotsB = generateUpcomingSlots(1, 9, 18, 30, new Date("2023-12-31T15:00:00Z"));
    expect(slotsA).toEqual(slotsB);
  });
});

describe("formatSlotLabel", () => {
  it("UTC ISO 문자열을 한국 시간 기준 월/일(요일) 시:분 형식으로 보여준다", () => {
    // 2024-01-02T00:00:00Z = 한국 시간 1/2(화) 09:00
    expect(formatSlotLabel("2024-01-02T00:00:00.000Z")).toBe("1/2(화) 09:00");
  });

  it("한국 날짜가 UTC 날짜와 다른 경우(자정 넘어가는 시간)도 한국 기준으로 보여준다", () => {
    // 2024-01-01T16:00:00Z = 한국 시간 1/2(화) 01:00 — UTC로는 여전히 1/1이지만
    // 한국 시간으로는 이미 날짜가 넘어간 케이스.
    expect(formatSlotLabel("2024-01-01T16:00:00.000Z")).toBe("1/2(화) 01:00");
  });
});
