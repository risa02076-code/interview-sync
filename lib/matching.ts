export const SLOT_LABELS = [
  "7/20(월) 10:00", "7/20(월) 14:00", "7/21(화) 11:00", "7/21(화) 15:00",
  "7/22(수) 09:00", "7/22(수) 13:00", "7/23(목) 10:00", "7/23(목) 16:00",
  "7/24(금) 11:00", "7/24(금) 15:00",
];

export type Interviewer = { id: string; name: string; role: string; busy_slots: number[] };
export type Room = { id: string; name: string; busy_slots: number[] };

export type MatchResult = {
  matchedSlot: number | null;
  roomId: string | null;
  status: "confirmed" | "rescheduled" | "escalated" | "pending";
  note: string;
};

/**
 * 재조율(broaden=true) 시에는 후보자의 원래 희망시간에 갇히지 않고 전체 슬롯을 재탐색한다.
 * (트러블슈팅 1번: 원래 희망시간 안에서만 찾으면 재조율 성공률이 떨어지는 문제를 발견해 수정함)
 */
export function findMatch(
  candidateSlots: number[],
  panelInterviewers: Interviewer[],
  rooms: Room[],
  broaden: boolean,
): MatchResult {
  const slotsToTry = broaden ? SLOT_LABELS.map((_, i) => i) : candidateSlots;

  if (!broaden && slotsToTry.length === 0) {
    return { matchedSlot: null, roomId: null, status: "pending", note: "후보자 희망 시간 입력 대기 중" };
  }

  for (const slot of slotsToTry) {
    const panelFree = panelInterviewers.every((p) => !p.busy_slots.includes(slot));
    if (!panelFree) continue;
    const freeRoom = rooms.find((r) => !r.busy_slots.includes(slot));
    if (!freeRoom) continue;
    return {
      matchedSlot: slot,
      roomId: freeRoom.id,
      status: broaden ? "rescheduled" : "confirmed",
      note: "",
    };
  }

  return {
    matchedSlot: null,
    roomId: null,
    status: "escalated",
    note: "패널 전원 공통 가능 시간 없음 — 리크루터 확인 필요",
  };
}
