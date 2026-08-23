import { describe, it, expect } from "vitest";
import { cellStripe, cellTint, type CellInfo } from "./slot-grid";

function info(over: Partial<CellInfo> = {}): CellInfo {
  return { key: "2024-01-02T00:00:00.000Z", ...over };
}

describe("cellTint — 색은 '불가능하다고 답한 인원 수'만 나타낸다", () => {
  it("충돌 0이면 초록이다", () => {
    expect(cellTint(info({ conflictCount: 0 }), 2)).toBe("rgba(34,197,94,0.18)");
  });

  it("충돌이 늘면 색이 바뀐다", () => {
    const one = cellTint(info({ conflictCount: 1 }), 2);
    const two = cellTint(info({ conflictCount: 2 }), 2);
    expect(one).not.toBe(two);
    expect(one).not.toBe("rgba(34,197,94,0.18)");
  });

  it("전원 초과 충돌은 전원과 같은 색으로 묶는다(비율 상한)", () => {
    expect(cellTint(info({ conflictCount: 5 }), 2)).toBe(cellTint(info({ conflictCount: 2 }), 2));
  });

  it("panelSize가 없으면 색을 칠하지 않는다", () => {
    expect(cellTint(info({ conflictCount: 1 }), undefined)).toBeUndefined();
  });

  it("conflictCount가 없으면 색을 칠하지 않는다", () => {
    expect(cellTint(info(), 2)).toBeUndefined();
  });

  it("히트맵이 없을 때만 warn 색을 쓴다", () => {
    expect(cellTint(info({ warn: true }), undefined)).toBe("rgba(245,158,11,0.16)");
    // 히트맵이 있으면 히트맵 색이 이긴다 — 두 채널이 섞이지 않도록.
    expect(cellTint(info({ warn: true, conflictCount: 0 }), 2)).toBe("rgba(34,197,94,0.18)");
  });

  it("panelSize가 0이면 투명이다(0으로 나누지 않는다)", () => {
    expect(cellTint(info({ conflictCount: 1 }), 0)).toBeUndefined();
  });
});

describe("cellStripe — 추정 여부는 색과 독립된 채널이다", () => {
  it("estimated면 사선 무늬를 낸다", () => {
    expect(cellStripe(info({ estimated: true }))).toContain("repeating-linear-gradient");
  });

  it("estimated가 아니면 무늬가 없다", () => {
    expect(cellStripe(info())).toBeUndefined();
    expect(cellStripe(info({ conflictCount: 0 }))).toBeUndefined();
  });

  it("충돌 0(초록)이면서 추정일 수 있다 — 두 채널이 동시에 살아 있어야 한다", () => {
    const i = info({ conflictCount: 0, estimated: true });
    expect(cellTint(i, 2)).toBe("rgba(34,197,94,0.18)");
    expect(cellStripe(i)).toBeTruthy();
  });

  it("undefined를 넘겨도 터지지 않는다", () => {
    expect(cellStripe(undefined)).toBeUndefined();
    expect(cellTint(undefined, 2)).toBeUndefined();
  });
});
