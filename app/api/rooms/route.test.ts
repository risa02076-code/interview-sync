import { describe, it, expect } from "vitest";
import { parseCapacity } from "./route";

describe("parseCapacity", () => {
  it("비워두면 '모름'(null)으로 받는다", () => {
    // 값을 모르는 것과 "작다"는 것은 다르다 — null이면 매칭에서 제한하지 않는다.
    for (const empty of [null, undefined, ""]) {
      expect(parseCapacity(empty)).toEqual({ ok: true, value: null });
    }
  });

  it("숫자 문자열도 받는다 (폼 입력은 항상 문자열로 온다)", () => {
    expect(parseCapacity("6")).toEqual({ ok: true, value: 6 });
  });

  it("숫자 그대로도 받는다", () => {
    expect(parseCapacity(6)).toEqual({ ok: true, value: 6 });
  });

  it("0이나 음수는 거절한다", () => {
    // 어떤 면접에도 배정될 수 없는 방이 화면에는 정상으로 보이게 된다.
    expect(parseCapacity(0).ok).toBe(false);
    expect(parseCapacity(-3).ok).toBe(false);
  });

  it("소수는 거절한다", () => {
    expect(parseCapacity(2.5).ok).toBe(false);
  });

  it("숫자가 아닌 값은 거절한다", () => {
    expect(parseCapacity("여섯").ok).toBe(false);
    expect(parseCapacity({}).ok).toBe(false);
  });
});
