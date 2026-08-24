import type { Room } from "./matching";

/**
 * 면접실을 고를 때 쓰는 판단 규칙.
 *
 * 지금까지 매칭은 "구간이 비어 있는 첫 번째 방"을 그대로 썼다. 방에 정원 정보가
 * 없었기 때문인데, 그래서 면접관 4명 면접에 2인실이 배정돼도 시스템은 알 방법이
 * 없었다(README의 "알려진 한계"). 정원과 사용 여부를 여기 한 곳에서 판단한다.
 */

/** 정원·사용 여부가 붙은 면접실. 두 컬럼은 migration_rooms_manage.sql에서 추가된다. */
export type ManagedRoom = Room & {
  /** null이면 "아직 모름" — 매칭에서 제한하지 않는다 */
  capacity?: number | null;
  active?: boolean | null;
};

/**
 * 그 면접에 실제로 몇 자리가 필요한지. 면접관 전원에 후보자 한 명을 더한다 —
 * 방을 잡는 이유가 후보자를 만나기 위해서이므로 후보자 자리를 빼면 항상 한 자리
 * 모자란 방을 고르게 된다.
 */
export function requiredCapacity(panelSize: number): number {
  return Math.max(1, panelSize) + 1;
}

/**
 * 이 방을 지금 이 면접에 쓸 수 있는지.
 *
 * capacity가 null이면 통과시킨다. 값을 모르는 것과 "작다"는 것은 다르고, 모른다는
 * 이유로 배정을 막으면 정원을 입력하기 전까지 확정이 전부 멈춘다. 대신 화면에서
 * "정원 미입력"을 눈에 띄게 표시해, 값을 넣는 순간부터 규칙이 걸린다는 것을 알린다.
 *
 * active는 명시적으로 false일 때만 제외한다 — 마이그레이션 전 데이터나 이 컬럼을
 * 선택하지 않은 조회에서는 undefined가 오는데, 그걸 "사용 안 함"으로 읽으면 모든
 * 방이 한꺼번에 배정 대상에서 빠진다.
 */
export function isRoomUsable(room: ManagedRoom, panelSize: number): boolean {
  if (room.active === false) return false;
  if (room.capacity == null) return true;
  return room.capacity >= requiredCapacity(panelSize);
}

/** 사람이 읽을 수 있는 제외 사유. 왜 이 방이 후보에서 빠졌는지 화면에서 설명할 때 쓴다. */
export function roomExclusionReason(room: ManagedRoom, panelSize: number): string | null {
  if (room.active === false) return "사용 안 함으로 표시된 면접실";
  if (room.capacity != null && room.capacity < requiredCapacity(panelSize)) {
    return `정원 ${room.capacity}명 — 이 면접에는 ${requiredCapacity(panelSize)}명(면접관 ${panelSize}명 + 후보자)이 필요`;
  }
  return null;
}

/** 이 면접실을 쓰는 확정 면접 하나가 실제로 차지하는 구간. */
export type RoomBooking = {
  interviewId: string;
  candidateName: string;
  /** occupiedSlots로 펼친 점유 구간 전체 (시작 슬롯 하나가 아니다) */
  slots: string[];
};

/**
 * 면접실이 "언제 차 있고 언제 비어 있는지"를 슬롯별로 정리한다.
 *
 * `busy_slots`만 보면 언제 찼는지는 알아도 **왜 찼는지**를 알 수 없다. 그 배열에는
 * 확정된 면접이 자동으로 넣은 시간과, 그 밖의 이유로 막힌 시간이 구분 없이 섞인다
 * (lib/backfillBusySlots.ts와 같은 문제). 확정 면접 쪽은 어느 면접인지 알 수 있으므로,
 * 여기서 이름을 붙여 두 종류를 갈라 놓는다 — 화면에서 "이하은 면접"과 "사유 미상"을
 * 구분해 보여주기 위한 것이다.
 *
 * 면접이 차지하는 슬롯인데 `busy_slots`에는 빠져 있는 경우도 결과에 넣는다. 그건
 * 실제로는 그 방이 쓰이고 있다는 뜻이고(확정 저장이 반쪽으로 끝났거나 소요시간 도입
 * 이전 데이터), 화면에서 빈칸으로 보이면 그 자리에 다른 면접을 넣게 된다.
 */
export function buildRoomOccupancy(
  busySlots: string[],
  bookings: RoomBooking[],
): Map<string, string | null> {
  const bySlot = new Map<string, string | null>();
  // 먼저 "찬 건 맞는데 사유 미상"으로 깔고,
  for (const slot of busySlots) bySlot.set(slot, null);
  // 확정 면접이 설명해주는 슬롯만 이름으로 덮어쓴다.
  for (const booking of bookings) {
    for (const slot of booking.slots) bySlot.set(slot, booking.candidateName);
  }
  return bySlot;
}
