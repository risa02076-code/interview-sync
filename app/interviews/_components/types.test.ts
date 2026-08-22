import { describe, it, expect } from "vitest";
import {
  addDays,
  dateRangeLabel,
  dayLabel,
  isSameDay,
  isSameDayAsSlot,
  startOfWeek,
} from "./types";
import { kstShifted } from "@/lib/slots";

// 캘린더 계산은 "한국 시간으로 시프트한 Date"를 쓰고 UTC getter로만 읽는다.
// 아래 테스트는 시간대를 명시한 Z 문자열만 써서, 실행 환경(KST든 UTC든)과
// 무관하게 같은 결과가 나오는지 검증한다.

// 2024-01-01T16:00:00Z = 한국 1/2(화) 01:00 — UTC로는 아직 1/1인 경계 케이스
const KST_TUE_EARLY = "2024-01-01T16:00:00.000Z";
// 2024-01-02T00:00:00Z = 한국 1/2(화) 09:00
const KST_TUE_MORNING = "2024-01-02T00:00:00.000Z";
// 2024-01-05T00:00:00Z = 한국 1/5(금) 09:00
const KST_FRI = "2024-01-05T00:00:00.000Z";

describe("startOfWeek (한국 기준)", () => {
  it("화요일이 속한 주의 월요일 자정을 돌려준다", () => {
    const monday = startOfWeek(kstShifted(KST_TUE_MORNING));
    expect(dayLabel(monday)).toBe("1/1(월)");
    expect(monday.getUTCHours()).toBe(0);
    expect(monday.getUTCMinutes()).toBe(0);
  });

  it("UTC로는 전날인 새벽 시각도 같은 주의 월요일을 낸다", () => {
    expect(dayLabel(startOfWeek(kstShifted(KST_TUE_EARLY)))).toBe("1/1(월)");
  });
});

describe("addDays / dayLabel / dateRangeLabel", () => {
  it("월요일부터 5일을 만들면 월~금이 된다", () => {
    const monday = startOfWeek(kstShifted(KST_TUE_MORNING));
    const days = Array.from({ length: 5 }, (_, i) => addDays(monday, i));
    expect(days.map(dayLabel)).toEqual(["1/1(월)", "1/2(화)", "1/3(수)", "1/4(목)", "1/5(금)"]);
  });

  it("기간 라벨은 시작과 끝 날짜를 보여준다", () => {
    const monday = startOfWeek(kstShifted(KST_TUE_MORNING));
    expect(dateRangeLabel(monday, addDays(monday, 4))).toBe("1/1 - 1/5");
  });
});

describe("isSameDay / isSameDayAsSlot", () => {
  it("한국 기준 같은 날이면 UTC 날짜가 달라도 같은 날로 본다", () => {
    expect(isSameDay(kstShifted(KST_TUE_EARLY), kstShifted(KST_TUE_MORNING))).toBe(true);
  });

  it("다른 날은 다른 날로 본다", () => {
    expect(isSameDay(kstShifted(KST_TUE_MORNING), kstShifted(KST_FRI))).toBe(false);
  });

  it("시프트된 날짜와 저장된 슬롯 키를 바로 비교할 수 있다", () => {
    const tuesday = kstShifted(KST_TUE_MORNING);
    expect(isSameDayAsSlot(tuesday, KST_TUE_EARLY)).toBe(true);
    expect(isSameDayAsSlot(tuesday, KST_FRI)).toBe(false);
  });
});
