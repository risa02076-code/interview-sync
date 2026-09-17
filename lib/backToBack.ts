import { SLOT_STEP_MINUTES } from "./slots";

export type PanelMember = { id: string; name: string; busy_slots: string[] };

/**
 * 면접관이 "이 시간 가능한가요?"라는 질문에는 그 시간 하나만 보고 답하지, 직전
 * 면접과 이어져서 쉬는 시간이 없어지는지까지는 스스로 따지지 않는다. 그래서 이
 * 판정을 사람의 응답에 맡기지 않고, 확정된(될) 시간 바로 앞 슬롯이 이미 막혀있는
 * 면접관을 찾아 기계적으로 감지한다.
 *
 * 강제로 막지는 않는다 — 이 함수는 "정보를 보여주는" 용도로만 쓴다(경고 표시,
 * 우선순위 자동 확정 시 대체 시간 선호). 앞뒤 둘 다가 아니라 "직전"만 보는 이유는
 * 두 면접 사이의 간격은 하나뿐이라, 앞뒤 모두에 여유를 요구하면 그 간격이 실제
 * 필요한 것보다 두 배로 요구된다.
 */
export function findNoRestBefore(panel: PanelMember[], slotStart: string): PanelMember[] {
  const prevSlot = new Date(new Date(slotStart).getTime() - SLOT_STEP_MINUTES * 60_000).toISOString();
  return panel.filter((p) => p.busy_slots.includes(prevSlot));
}
