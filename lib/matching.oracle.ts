/**
 * findMatch(lib/matching.ts)와 완전히 독립적으로, PRD.md "7. 확정된 규칙 예시"에
 * 사람이 직접 확정해둔 숫자만 보고 처음부터 다시 짠 계산기(오라클)다.
 *
 * lib/matching.ts·lib/slots.ts·lib/rooms.ts의 함수를 단 하나도 재사용하지 않는다
 * — 재사용하면 같은 버그를 공유해서 대조가 무의미해진다(lib/matching.oracle.test.ts
 * 참고). 시간 계산도 일부러 다른 방식(분 단위 정수 연산)으로 짰다 — 원본이 Date
 * 객체 시프트로 계산하는 것과 접근 자체를 다르게 해서, 같은 실수를 우연히 똑같이
 *반복할 확률을 낮췄다.
 */

const KST_OFFSET_MINUTES = 9 * 60;
const SLOT_MINUTES = 30;
const BUSINESS_START_MINUTES = 9 * 60; // PRD §7-3: 09:00
const BUSINESS_END_MINUTES = 18 * 60; // PRD §7-3: 18:00

/** PRD §7-1: 대면 60분 · 온라인 30분 · 전화 30분 */
const DURATION_BY_TYPE: Record<string, number> = {
  "1차 대면": 60,
  "2차 대면": 60,
  온라인: 30,
  전화: 30,
};

export type OracleInterviewer = { id: string; busy_slots: string[] };
export type OracleRoom = { id: string; busy_slots: string[]; capacity?: number | null; active?: boolean | null };

function oracleDuration(interviewType: string): number {
  return DURATION_BY_TYPE[interviewType] ?? SLOT_MINUTES;
}

/** 이 ISO 시각이 한국 시간 기준 하루 중 몇 분째인지(0~1439). */
function kstMinuteOfDay(iso: string): number {
  const shifted = new Date(new Date(iso).getTime() + KST_OFFSET_MINUTES * 60_000);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
}

/** PRD §7-3: 시작부터 소요시간이 끝날 때까지 전부 09:00~18:00 안에 있어야 한다. */
function withinBusinessHours(startIso: string, durationMinutes: number): boolean {
  const start = kstMinuteOfDay(startIso);
  return start >= BUSINESS_START_MINUTES && start + durationMinutes <= BUSINESS_END_MINUTES;
}

/** 이 시작 시각부터 소요시간 동안 실제로 차지하는 30분 슬롯 전체. */
function slotsSpanned(startIso: string, durationMinutes: number): string[] {
  const startMs = new Date(startIso).getTime();
  const slotCount = Math.ceil(durationMinutes / SLOT_MINUTES);
  const spanned: string[] = [];
  for (let i = 0; i < slotCount; i++) {
    spanned.push(new Date(startMs + i * SLOT_MINUTES * 60_000).toISOString());
  }
  return spanned;
}

/** PRD §7-2: 정원 = 면접관 + 후보자 1명. capacity가 없으면(null) 제한하지 않는다. */
function isRoomBigEnough(room: OracleRoom, interviewerCount: number): boolean {
  if (room.active === false) return false;
  if (room.capacity == null) return true;
  return room.capacity >= interviewerCount + 1;
}

/**
 * 후보자가 제출한 순서대로 시간을 훑어, 전원(면접관 전체 + 필요하면 방까지) 비어
 * 있는 첫 번째 시간을 확정한다. 어느 것도 안 되면 matchedSlot은 null이다.
 */
export function oracleFindMatch(
  candidateSlots: string[],
  interviewers: OracleInterviewer[],
  rooms: OracleRoom[],
  interviewType: string,
  roomRequired: boolean,
): { matchedSlot: string | null; roomId: string | null } {
  const durationMinutes = oracleDuration(interviewType);

  for (const candidate of candidateSlots) {
    if (!withinBusinessHours(candidate, durationMinutes)) continue;

    const span = slotsSpanned(candidate, durationMinutes);
    const everyoneFree = interviewers.every((person) => !span.some((slot) => person.busy_slots.includes(slot)));
    if (!everyoneFree) continue;

    if (!roomRequired) {
      return { matchedSlot: candidate, roomId: null };
    }

    const availableRoom = rooms.find(
      (room) => isRoomBigEnough(room, interviewers.length) && !span.some((slot) => room.busy_slots.includes(slot)),
    );
    if (!availableRoom) continue;

    return { matchedSlot: candidate, roomId: availableRoom.id };
  }

  return { matchedSlot: null, roomId: null };
}
