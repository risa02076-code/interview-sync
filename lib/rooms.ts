import type { Room } from "./matching";

/**
 * 회의실을 고를 때 쓰는 판단 규칙.
 *
 * 지금까지 매칭은 "구간이 비어 있는 첫 번째 방"을 그대로 썼다. 방에 정원 정보가
 * 없었기 때문인데, 그래서 면접관 4명 면접에 2인실이 배정돼도 시스템은 알 방법이
 * 없었다(README의 "알려진 한계"). 정원과 사용 여부를 여기 한 곳에서 판단한다.
 */

/** 정원·사용 여부가 붙은 회의실. 두 컬럼은 migration_rooms_manage.sql에서 추가된다. */
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
  if (room.active === false) return "사용 안 함으로 표시된 회의실";
  if (room.capacity != null && room.capacity < requiredCapacity(panelSize)) {
    return `정원 ${room.capacity}명 — 이 면접에는 ${requiredCapacity(panelSize)}명(면접관 ${panelSize}명 + 후보자)이 필요`;
  }
  return null;
}
