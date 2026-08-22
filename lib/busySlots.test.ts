import { describe, it, expect } from "vitest";
import { groupBusySlotsByDay, formatRespondedAt } from "./busySlots";

// 시간대를 명시한(Z) 문자열만 쓴다. 오프셋 없는 문자열이나 new Date(2024, 0, 2, ...)
// 같은 로컬 생성자를 쓰면 테스트가 실행 환경의 타임존을 따라 움직여서, 코드가
// 로컬 시간으로 잘못 계산해도 함께 어긋난 채 통과한다(slots.test.ts와 같은 이유).

describe("groupBusySlotsByDay", () => {
  it("같은 날짜의 시간들을 하나의 그룹으로 묶고 시간순 정렬한다", () => {
    const groups = groupBusySlotsByDay([
      "2024-01-03T04:30:00.000Z", // 한국 1/3(수) 13:30
      "2024-01-02T00:00:00.000Z", // 한국 1/2(화) 09:00
      "2024-01-02T00:30:00.000Z", // 한국 1/2(화) 09:30
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].dayLabel).toBe("1/2(화)");
    expect(groups[0].times).toEqual(["09:00", "09:30"]);
    expect(groups[1].dayLabel).toBe("1/3(수)");
    expect(groups[1].times).toEqual(["13:30"]);
  });

  it("UTC로는 날짜가 다른 시간도 한국 날짜 기준으로 같은 그룹에 묶는다", () => {
    // 둘 다 한국 시간으로는 1/2 — UTC 날짜(1/1 vs 1/2)로 묶으면 두 그룹이 된다.
    const groups = groupBusySlotsByDay([
      "2024-01-01T16:00:00.000Z", // 한국 1/2(화) 01:00
      "2024-01-02T00:00:00.000Z", // 한국 1/2(화) 09:00
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].dayLabel).toBe("1/2(화)");
    expect(groups[0].times).toEqual(["01:00", "09:00"]);
  });

  it("빈 배열이면 빈 배열을 반환한다", () => {
    expect(groupBusySlotsByDay([])).toEqual([]);
  });
});

describe("formatRespondedAt", () => {
  it("null이면 null을 반환한다", () => {
    expect(formatRespondedAt(null)).toBeNull();
  });

  it("월/일 시:분 형식으로 짧게 보여준다", () => {
    // 2024-01-02T07:20:00Z = 한국 1/2 16:20
    expect(formatRespondedAt("2024-01-02T07:20:00.000Z")).toBe("1/2 16:20");
  });

  it("UTC 날짜가 지나기 전 시각도 한국 날짜로 보여준다", () => {
    // 2024-01-01T16:00:00Z = 한국 1/2 01:00 (UTC로는 아직 1/1)
    expect(formatRespondedAt("2024-01-01T16:00:00.000Z")).toBe("1/2 01:00");
  });
});
