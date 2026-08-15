import { describe, it, expect } from "vitest";
import { groupBusySlotsByDay, formatRespondedAt } from "./busySlots";

describe("groupBusySlotsByDay", () => {
  it("같은 날짜의 시간들을 하나의 그룹으로 묶고 시간순 정렬한다", () => {
    const groups = groupBusySlotsByDay([
      "2024-01-03T04:30:00.000Z", // 1/3 13:30
      "2024-01-02T00:00:00.000Z", // 1/2 09:00
      "2024-01-02T00:30:00.000Z", // 1/2 09:30
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].dayLabel).toBe("1/2(화)");
    expect(groups[0].times).toEqual(["09:00", "09:30"]);
    expect(groups[1].dayLabel).toBe("1/3(수)");
    expect(groups[1].times).toEqual(["13:30"]);
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
    const dt = new Date(2024, 0, 2, 16, 20);
    expect(formatRespondedAt(dt.toISOString())).toBe("1/2 16:20");
  });
});
