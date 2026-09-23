import { describe, it, expect } from "vitest";
import { resolveManualConfirmNote } from "./manualConfirmNote";

const SLOT_A = "2024-01-02T01:00:00.000Z";
const SLOT_B = "2024-01-02T01:30:00.000Z";

describe("resolveManualConfirmNote", () => {
  it("전원 응답했고 겹침도 없으면 그대로 진행하고 기본 문구만 남긴다", () => {
    const panel = [{ id: "p1", name: "배지훈", busy_slots: [] }];
    const result = resolveManualConfirmNote(panel, [SLOT_A], new Set(["p1"]), false);
    expect(result).toEqual({ ok: true, note: "리크루터가 직접 확정함" });
  });

  it("겹치는 면접관이 있으면 진행하되 이름을 남긴다", () => {
    const panel = [{ id: "p1", name: "배지훈", busy_slots: [SLOT_A] }];
    const result = resolveManualConfirmNote(panel, [SLOT_A], new Set(["p1"]), false);
    expect(result).toEqual({ ok: true, note: "리크루터가 직접 확정함 (겹침: 배지훈)" });
  });

  it("미응답자가 있으면 진행하지 않고 보류(held)한다", () => {
    const panel = [
      { id: "p1", name: "배지훈", busy_slots: [] },
      { id: "p2", name: "오세훈", busy_slots: [] },
    ];
    const result = resolveManualConfirmNote(panel, [SLOT_A], new Set(["p1"]), false);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.held).toBe(true);
      expect(result.error).toContain("오세훈");
    }
  });

  it("미응답자가 있어도 confirmDespiteUnresponded면 진행하고 그 사실을 note에 남긴다", () => {
    const panel = [
      { id: "p1", name: "배지훈", busy_slots: [] },
      { id: "p2", name: "오세훈", busy_slots: [] },
    ];
    const result = resolveManualConfirmNote(panel, [SLOT_A], new Set(["p1"]), true);
    expect(result).toEqual({
      ok: true,
      note: "리크루터가 직접 확정함 (⚠️ 미응답 상태로 확정: 오세훈 — 이들의 '가능'은 답변이 아니라 침묵으로 추정한 것입니다)",
    });
  });

  it("겹침과 미응답이 동시에 있고 강행하면 둘 다 남긴다", () => {
    const panel = [
      { id: "p1", name: "배지훈", busy_slots: [SLOT_A] },
      { id: "p2", name: "오세훈", busy_slots: [] },
    ];
    const result = resolveManualConfirmNote(panel, [SLOT_A], new Set(["p1"]), true);
    expect(result).toEqual({
      ok: true,
      note: "리크루터가 직접 확정함 (겹침: 배지훈 / ⚠️ 미응답 상태로 확정: 오세훈 — 이들의 '가능'은 답변이 아니라 침묵으로 추정한 것입니다)",
    });
  });

  it("응답을 안 했으면 확정 구간과 겹치지 않아도 여전히 보류한다(응답 안 하면 사정 자체를 모르므로)", () => {
    const panel = [{ id: "p1", name: "배지훈", busy_slots: [] }];
    const result = resolveManualConfirmNote(panel, [SLOT_B], new Set(), false);
    expect(result.ok).toBe(false);
  });
});
