export type ManualConfirmPanelMember = { id: string; name: string; busy_slots: string[] };

export type ManualConfirmNoteResult = { ok: true; note: string } | { ok: false; held: true; error: string };

/**
 * 리크루터가 히트맵을 보고 직접 확정할 때, 진행해도 되는지와 남길 note를 계산한다.
 *
 * 히트맵의 "가능"(초록색)에는 두 가지가 섞여 있다 — 실제로 가능하다고 답한 것과,
 * 아직 답장 자체를 안 한 것(침묵)이다. busy_slots만 보면 둘 다 "막힌 기록 없음"으로
 * 똑같이 보여서, 담당자가 화면에서 이 구분을 놓치고 확정 버튼을 누르면 그 사실이
 * 그대로 사라진다 — 확정 뒤에는 "그때 누가 응답을 안 한 상태였는지" 알 방법이 없었다.
 *
 * 그래서 사람이 알아채는 데 기대지 않고, 미응답자가 있으면 먼저 멈춰 세운다
 * (sendConfirmationEmail의 정합성 보류(held)와 같은 패턴). 담당자가 그래도
 * 진행하겠다고 결정하면(confirmDespiteUnresponded) 그 사실을 note에 영구히 남긴다 —
 * 확정 자체를 막는 게 목적이 아니라, "몰랐다"가 아니라 "알고도 진행했다"로 만드는 것이
 * 목적이다.
 */
export function resolveManualConfirmNote(
  panel: ManualConfirmPanelMember[],
  span: string[],
  respondedIds: Set<string>,
  confirmDespiteUnresponded: boolean,
): ManualConfirmNoteResult {
  const conflicts = panel.filter((p) => span.some((s) => p.busy_slots.includes(s))).map((p) => p.name);
  const unresponded = panel.filter((p) => !respondedIds.has(p.id)).map((p) => p.name);

  if (unresponded.length && !confirmDespiteUnresponded) {
    return {
      ok: false,
      held: true,
      error: `아직 응답하지 않은 면접관이 있습니다: ${unresponded.join(", ")} — 이들의 '가능'은 답변이 아니라 침묵으로 추정한 것입니다. 그래도 이 시간으로 확정하시겠습니까?`,
    };
  }

  const parts: string[] = [];
  if (conflicts.length) parts.push(`겹침: ${conflicts.join(", ")}`);
  if (unresponded.length) {
    parts.push(
      `⚠️ 미응답 상태로 확정: ${unresponded.join(", ")} — 이들의 '가능'은 답변이 아니라 침묵으로 추정한 것입니다`,
    );
  }

  return { ok: true, note: parts.length ? `리크루터가 직접 확정함 (${parts.join(" / ")})` : "리크루터가 직접 확정함" };
}
