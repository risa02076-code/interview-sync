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
