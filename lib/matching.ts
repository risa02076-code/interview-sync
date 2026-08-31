import { isRoomUsable, type ManagedRoom } from "./rooms";
import {
  SLOT_STEP_MINUTES,
  fitsInBusinessHours,
  generateUpcomingSlots,
  occupiedSlots,
} from "./slots";

export type Interviewer = { id: string; name: string; role: string; busy_slots: string[] };
/**
 * 매칭이 최소한으로 필요로 하는 면접실 정보. 정원·사용 여부(capacity/active)는
 * ManagedRoom(lib/rooms.ts)에 선택 필드로 있고, 없으면 종전대로 제한 없이 동작한다.
 */
export type Room = { id: string; name: string; busy_slots: string[] };

export type MatchResult = {
  matchedSlot: string | null;
  roomId: string | null;
  status: "confirmed" | "rescheduled" | "escalated" | "pending";
  note: string;
};

export const INTERVIEW_TYPES = ["1차 대면", "2차 대면", "온라인", "전화"] as const;
export type InterviewType = (typeof INTERVIEW_TYPES)[number];

/** 대면 면접만 면접실이 필요하다. 온라인/전화는 면접실 없이도 매칭 가능하다. */
export function requiresRoom(interviewType: string): boolean {
  return interviewType === "1차 대면" || interviewType === "2차 대면";
}

/**
 * 재조율(broaden=true) 시에는 후보자의 원래 희망시간에 갇히지 않고, 지금 기준으로
 * 다시 계산한 전체 영업일 슬롯을 재탐색한다.
 * (트러블슈팅 1번: 원래 희망시간 안에서만 찾으면 재조율 성공률이 떨어지는 문제를 발견해 수정함)
 *
 * durationMinutes는 면접이 실제로 차지하는 시간이다. 시작 슬롯 하나가 아니라 그
 * 시간이 걸치는 슬롯 전체가 비어 있어야만 확정한다 — 1시간 면접을 10:00에 넣으려면
 * 10:00과 10:30이 모두 비어 있어야 한다. 기본값은 격자 한 칸(30분)으로, 소요시간을
 * 넘기지 않은 호출은 종전과 동일하게 동작한다.
 */
export function findMatch(
  candidateSlots: string[],
  panelInterviewers: Interviewer[],
  rooms: ManagedRoom[],
  broaden: boolean,
  roomRequired: boolean = true,
  durationMinutes: number = SLOT_STEP_MINUTES,
): MatchResult {
  const slotsToTry = broaden ? generateUpcomingSlots().map((s) => s.key) : candidateSlots;

  if (!broaden && slotsToTry.length === 0) {
    return { matchedSlot: null, roomId: null, status: "pending", note: "후보자 희망 시간 입력 대기 중" };
  }

  for (const slot of slotsToTry) {
    // 업무시간을 넘겨 끝나는 시작 시간은 애초에 후보가 아니다(17:30 시작 1시간 면접).
    if (!fitsInBusinessHours(slot, durationMinutes)) continue;

    const span = occupiedSlots(slot, durationMinutes);
    const panelFree = panelInterviewers.every((p) => span.every((s) => !p.busy_slots.includes(s)));
    if (!panelFree) continue;

    let roomId: string | null = null;
    if (roomRequired) {
      // 비어 있는 것만으로는 부족하다 — 사용 안 함으로 표시됐거나 인원이 안 들어가는
      // 방은 애초에 후보가 아니다(lib/rooms.ts). 정원을 모르는 방은 종전대로 통과한다.
      const freeRoom = rooms.find(
        (r) =>
          isRoomUsable(r, panelInterviewers.length) &&
          span.every((s) => !r.busy_slots.includes(s)),
      );
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

export type SlotRecommendation = {
  slot: string;
  /** 이 시간에 참석할 수 없다고 답한 면접관 이름 */
  conflicts: string[];
  /**
   * 면접관은 전원 가능한데 쓸 수 있는 빈 면접실이 없어 막힌 경우.
   *
   * conflicts 는 면접관 이름만 담기 때문에, 이 값을 함께 보지 않으면 면접실이 없어
   * 확정할 수 없는 시간이 "충돌 0 = 확정 가능"으로 읽힌다. 실제로 그 어긋남 때문에
   * 후보자에게 확정할 수 없는 시간이 "가능"으로 안내되고 있었다 — 판정은 반드시
   * isImmediatelyBookable 을 쓴다.
   */
  roomBlocked: boolean;
};

/** 지금 이 시간에 바로 확정할 수 있는가 — 면접관 전원 가능 + 쓸 수 있는 빈 면접실 확보. */
export function isImmediatelyBookable(r: SlotRecommendation): boolean {
  return r.conflicts.length === 0 && !r.roomBlocked;
}

/** 충돌이 있는(완전히 겹치지 않는 시간이 하나도 없는) 경우에만 이 개수로 제한한다 */
const MAX_FALLBACK_RECOMMENDATIONS = 3;

/**
 * 패널 전원이 동시에 가능한 시간이 없을 수도 있다는 전제 아래, 전체 후보 슬롯의
 * "충돌(면접관 불가능 + 면접실 없음)" 점수를 모두 계산해 가장 낮은 점수와 동점인
 * 시간들을 추천한다. 전원 동시 가능(충돌 0)한 시간은 후보자가 고를 여지를 넓히기
 * 위해 개수 제한 없이 전부 반환하고, 하나도 없으면 그다음으로 충돌이 적은 시간들을
 * 최대 MAX_FALLBACK_RECOMMENDATIONS개까지만 대안으로 반환한다.
 *
 * 충돌 판정도 findMatch와 같은 기준을 쓴다 — 시작 슬롯만 보면 후보자에게 "전원
 * 가능"이라고 안내한 시간이 확정 단계에서 겹침으로 걸러지는 어긋남이 생긴다.
 */
export function recommendLeastConflictSlots(
  panelInterviewers: Interviewer[],
  rooms: ManagedRoom[],
  roomRequired: boolean,
  businessDays: number = 5,
  excludeSlots: string[] = [],
  durationMinutes: number = SLOT_STEP_MINUTES,
): SlotRecommendation[] {
  const excluded = new Set(excludeSlots);
  const scored = generateUpcomingSlots(businessDays)
    .filter((s) => !excluded.has(s.key) && fitsInBusinessHours(s.key, durationMinutes))
    .map((s) => {
      const span = occupiedSlots(s.key, durationMinutes);
      const conflicts = panelInterviewers
        .filter((p) => span.some((slot) => p.busy_slots.includes(slot)))
        .map((p) => p.name);
      // 추천 점수도 같은 기준으로 매긴다 — 여기서만 정원을 무시하면, 실제로는
      // 배정할 수 없는 시간이 "면접실 문제 없음"으로 추천된다.
      const roomBlocked =
        roomRequired &&
        !rooms.some(
          (r) =>
            isRoomUsable(r, panelInterviewers.length) &&
            span.every((slot) => !r.busy_slots.includes(slot)),
        );
      return { slot: s.key, conflicts, roomBlocked, score: conflicts.length + (roomBlocked ? 1 : 0) };
    });
  if (!scored.length) return [];

  const minScore = Math.min(...scored.map((s) => s.score));
  const tied = scored.filter((s) => s.score === minScore);
  const limited = minScore === 0 ? tied : tied.slice(0, MAX_FALLBACK_RECOMMENDATIONS);
  return limited.map(({ slot, conflicts, roomBlocked }) => ({ slot, conflicts, roomBlocked }));
}
