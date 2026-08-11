import { generateUpcomingSlots } from "./slots";

export type Interviewer = { id: string; name: string; role: string; busy_slots: string[] };
export type Room = { id: string; name: string; busy_slots: string[] };

export type MatchResult = {
  matchedSlot: string | null;
  roomId: string | null;
  status: "confirmed" | "rescheduled" | "escalated" | "pending";
  note: string;
};

export const INTERVIEW_TYPES = ["1차 대면", "2차 대면", "온라인", "전화"] as const;
export type InterviewType = (typeof INTERVIEW_TYPES)[number];

/** 대면 면접만 회의실이 필요하다. 온라인/전화는 회의실 없이도 매칭 가능하다. */
export function requiresRoom(interviewType: string): boolean {
  return interviewType === "1차 대면" || interviewType === "2차 대면";
}

/**
 * 재조율(broaden=true) 시에는 후보자의 원래 희망시간에 갇히지 않고, 지금 기준으로
 * 다시 계산한 전체 영업일 슬롯을 재탐색한다.
 * (트러블슈팅 1번: 원래 희망시간 안에서만 찾으면 재조율 성공률이 떨어지는 문제를 발견해 수정함)
 */
export function findMatch(
  candidateSlots: string[],
  panelInterviewers: Interviewer[],
  rooms: Room[],
  broaden: boolean,
  roomRequired: boolean = true,
): MatchResult {
  const slotsToTry = broaden ? generateUpcomingSlots().map((s) => s.key) : candidateSlots;

  if (!broaden && slotsToTry.length === 0) {
    return { matchedSlot: null, roomId: null, status: "pending", note: "후보자 희망 시간 입력 대기 중" };
  }

  for (const slot of slotsToTry) {
    const panelFree = panelInterviewers.every((p) => !p.busy_slots.includes(slot));
    if (!panelFree) continue;

    let roomId: string | null = null;
    if (roomRequired) {
      const freeRoom = rooms.find((r) => !r.busy_slots.includes(slot));
      if (!freeRoom) continue;
      roomId = freeRoom.id;
    }

    return {
      matchedSlot: slot,
      roomId,
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

export type SlotRecommendation = { slot: string; conflicts: string[] };

/**
 * 패널 전원이 동시에 가능한 시간이 없을 수도 있다는 전제 아래, 전체 후보 슬롯 중
 * "충돌(면접관 불가능 + 회의실 없음)이 가장 적은" 시간을 하나 골라 추천한다.
 * 완전히 비어있는 슬롯이 있으면 그게 곧 충돌 0인 최선의 추천이 된다.
 */
export function recommendLeastConflictSlot(
  panelInterviewers: Interviewer[],
  rooms: Room[],
  roomRequired: boolean,
): SlotRecommendation | null {
  const candidates = generateUpcomingSlots().map((s) => s.key);
  let best: (SlotRecommendation & { score: number }) | null = null;

  for (const slot of candidates) {
    const conflicts = panelInterviewers.filter((p) => p.busy_slots.includes(slot)).map((p) => p.name);
    const roomBlocked = roomRequired && !rooms.some((r) => !r.busy_slots.includes(slot));
    const score = conflicts.length + (roomBlocked ? 1 : 0);

    if (!best || score < best.score) {
      best = { slot, conflicts, score };
      if (score === 0) break; // 충돌 0인 슬롯을 찾았으면 더 나은 대안은 없다
    }
  }

  return best ? { slot: best.slot, conflicts: best.conflicts } : null;
}
