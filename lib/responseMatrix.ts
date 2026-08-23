import {
  fitsInBusinessHours,
  interviewsOverlap,
  occupiedSlots,
} from "./slots";

/**
 * 히트맵에 필요한 최소한의 면접관 정보.
 *
 * responded가 핵심이다. busy_slots만 보면 "가능하다고 답한 사람"과 "아직 답하지
 * 않은 사람"이 구분되지 않는다 — 둘 다 busy_slots에 그 시간이 없기 때문이다.
 * 이 구분이 없으면 화면이 추정을 확정처럼 보여준다.
 */
export type MatrixInterviewer = {
  id: string;
  name: string;
  responded: boolean;
  busy_slots: string[];
};

export type MatrixRoom = { id: string; name: string; busy_slots: string[] };

export type ResponseMatrixInput = {
  interviewers: MatrixInterviewer[];
  rooms: MatrixRoom[];
  /** 후보자가 제출한 희망 순위 (순서가 곧 1·2·3순위) */
  preferredSlots: string[];
  matchedSlot: string | null;
  /** 지금 기준 후보 슬롯(/api/slots) */
  gridSlots: string[];
  /** 지난 라운드 응답에 등장한 슬롯 — 격자에 없어도 축에 포함시켜야 한다 */
  historySlots?: string[];
  needsRoom: boolean;
  durationMinutes: number;
};

export type SlotState = {
  slot: string;
  /** 응답을 마쳤고, 이 시간이 불가능 목록에 없는 사람 */
  available: string[];
  /** 응답을 마쳤고, 이 시간을 불가능하다고 표시한 사람 */
  unavailable: string[];
  /** 아직 답하지 않은 사람 — 이 칸의 값은 추정이다 */
  unknown: string[];
  /**
   * 확정된 면접이 차지하는 구간이라, busy_slots의 그 항목이 "본인이 안 된다고 한
   * 것"인지 "이 면접이 잡혀서 들어간 것"인지 구분할 수 없는 사람.
   * (확정 시 busy_slots에 확정 시간이 추가되기 때문 — lib/applyMatch.ts 참고)
   */
  ambiguous: string[];
  /** 1·2·3 (후보자 제출 순위), 아니면 null */
  candidateRank: number | null;
  /** 이 30분에 쓸 수 있는 회의실이 하나라도 있는지 (회의실이 필요 없는 유형이면 항상 true) */
  roomFree: boolean;
  /** 확정된 면접의 시작 시간 */
  isMatchedStart: boolean;
  /** 확정된 면접이 차지하는 구간(시작 슬롯 포함) */
  occupiedByMatch: boolean;
  /**
   * 이 시간에 시작하면 매칭 조건을 통과하는지. findMatch와 같은 기준으로 계산한다
   * — 즉 미응답자는 "가능"으로 취급된다. 그래서 startable이 true인데 unknown이
   * 비어 있지 않으면, 통과의 근거가 답변이 아니라 침묵이라는 뜻이다.
   */
  startable: boolean;
};

/** ISO 문자열은 사전순 정렬이 곧 시간순이다. */
function sortedUnique(values: string[]): string[] {
  return [...new Set(values)].sort();
}

/**
 * 슬롯 하나하나에 대해 "누가 가능/불가능/미응답인지"를 계산한다.
 *
 * 시간 축을 gridSlots만으로 잡으면 지난 라운드 응답이 잘린다 — /api/slots는 지금
 * 기준 앞으로의 영업일만 만들기 때문이다. 그래서 응답에 등장한 슬롯을 모두 합집합으로
 * 모은다.
 */
export function buildResponseMatrix(input: ResponseMatrixInput): {
  slots: string[];
  states: Map<string, SlotState>;
} {
  const {
    interviewers,
    rooms,
    preferredSlots,
    matchedSlot,
    gridSlots,
    historySlots = [],
    needsRoom,
    durationMinutes,
  } = input;

  const matchSpan = matchedSlot ? new Set(occupiedSlots(matchedSlot, durationMinutes)) : new Set<string>();

  const slots = sortedUnique([
    ...gridSlots,
    ...historySlots,
    ...preferredSlots,
    ...interviewers.flatMap((p) => p.busy_slots),
    ...(matchedSlot ? occupiedSlots(matchedSlot, durationMinutes) : []),
  ]);

  const rankBySlot = new Map(preferredSlots.map((s, i) => [s, i + 1]));
  const states = new Map<string, SlotState>();

  for (const slot of slots) {
    const available: string[] = [];
    const unavailable: string[] = [];
    const unknown: string[] = [];
    const ambiguous: string[] = [];

    for (const person of interviewers) {
      const busyHere = person.busy_slots.includes(slot);
      if (!person.responded) {
        unknown.push(person.name);
      } else if (busyHere && matchSpan.has(slot)) {
        ambiguous.push(person.name);
      } else if (busyHere) {
        unavailable.push(person.name);
      } else {
        available.push(person.name);
      }
    }

    const span = occupiedSlots(slot, durationMinutes);
    const roomFree = !needsRoom || rooms.some((r) => span.every((s) => !r.busy_slots.includes(s)));

    // findMatch와 같은 기준: 구간 전체가 비어 있고 업무시간 안에서 끝나야 한다.
    // 확정된 이 면접 자신이 만든 점유는 제외한다(그러지 않으면 확정된 시간이
    // "시작 불가"로 보인다).
    const panelFreeForSpan = interviewers.every((p) =>
      span.every((s) => !p.busy_slots.includes(s) || matchSpan.has(s)),
    );
    const startable =
      fitsInBusinessHours(slot, durationMinutes) && panelFreeForSpan && roomFree;

    states.set(slot, {
      slot,
      available,
      unavailable,
      unknown,
      ambiguous,
      candidateRank: rankBySlot.get(slot) ?? null,
      roomFree,
      isMatchedStart: matchedSlot === slot,
      occupiedByMatch: matchSpan.has(slot),
      startable,
    });
  }

  return { slots, states };
}

/**
 * 히트맵 색을 칠할 때 쓸 값. SlotGrid는 conflictCount(색)와 warn(주황 틴트) 두
 * 채널만 받으므로, "불가능하다고 답한 인원 수"를 색에, "미응답자가 있는지"를
 * 별도 신호로 넘긴다 — 두 개를 한 숫자로 합치면 확정과 추정이 같은 색이 된다.
 */
export function heatInputs(state: SlotState): { conflictCount: number; estimated: boolean } {
  const roomPenalty = state.roomFree ? 0 : 1;
  return {
    conflictCount: state.unavailable.length + roomPenalty,
    estimated: state.unknown.length > 0,
  };
}

/** 확정된 면접과 시간이 겹치는 슬롯인지 (히트맵에서 확정 구간을 표시할 때 쓴다) */
export function overlapsMatched(
  slot: string,
  matchedSlot: string | null,
  durationMinutes: number,
): boolean {
  if (!matchedSlot) return false;
  return interviewsOverlap(slot, durationMinutes, matchedSlot, durationMinutes);
}
