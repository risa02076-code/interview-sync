export type Slot = { key: string; label: string };

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 서버 타임존과 무관하게 항상 "한국 기준" 시간으로 계산하기 위한 고정 오프셋.
 * Vercel 서버는 UTC로 도는데, Date의 getHours/setHours 같은 "로컬 시간" 메서드는
 * 서버가 있는 시간대를 그대로 따른다 — 로컬 개발 환경(한국 시간)에서는 이 문제가
 * 전혀 안 보이고, 실제 배포된 서버에서만 9시간 어긋난 채로 조용히 작동했다.
 * (lib/sendReminders.ts의 kstDateKey와 같은 원리)
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 오늘(또는 from) 기준 다음 영업일(주말 제외) N일 동안, 한국 시간 기준 업무시간
 * (기본 09~18시)을 step분(기본 30분) 단위로 잘라 후보 슬롯으로 생성한다
 * (when2meet처럼 30분 단위 그리드). 하드코딩된 날짜 목록 대신 매번 "현재" 기준으로
 * 계산된다.
 */
export function generateUpcomingSlots(
  businessDays = 5,
  startHour = 9,
  endHour = 18,
  stepMinutes = 30,
  from: Date = new Date(),
): Slot[] {
  const slots: Slot[] = [];
  // "지금"의 UTC 필드를 한국 날짜의 필드로 그대로 읽을 수 있도록, 9시간 시프트한
  // 가상의 기준시각에서 날짜만 뽑는다(서버가 어느 시간대에서 돌든 항상 동일하게
  // 한국 날짜가 나온다).
  const kstNow = new Date(from.getTime() + KST_OFFSET_MS);
  const cursor = new Date(Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate()));
  cursor.setUTCDate(cursor.getUTCDate() + 1); // 내일부터 제안

  let daysAdded = 0;
  while (daysAdded < businessDays) {
    const day = cursor.getUTCDay();
    if (day !== 0 && day !== 6) {
      for (let minutes = startHour * 60; minutes < endHour * 60; minutes += stepMinutes) {
        // cursor는 "한국 자정"을 시프트된 기준으로 표현한 값이라, 실제 UTC
        // 인스턴트(슬롯 키로 저장할 값)로 되돌리려면 그 오프셋을 다시 빼야 한다.
        const utcInstant = cursor.getTime() + minutes * 60_000 - KST_OFFSET_MS;
        const dt = new Date(utcInstant);
        slots.push({ key: dt.toISOString(), label: formatSlotLabel(dt.toISOString()) });
      }
      daysAdded += 1;
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return slots;
}

/**
 * 저장된 슬롯 키(UTC ISO 문자열)를 한국 시간 기준 라벨로 변환한다. 서버든
 * 브라우저든, 실행되는 곳의 로컬 시간대와 무관하게 항상 같은(한국) 결과가
 * 나오도록 로컬 getter 대신 명시적으로 9시간을 더해 UTC 필드를 읽는다.
 */
export function formatSlotLabel(key: string): string {
  const kst = new Date(new Date(key).getTime() + KST_OFFSET_MS);
  const month = kst.getUTCMonth() + 1;
  const date = kst.getUTCDate();
  const day = DAY_NAMES[kst.getUTCDay()];
  const hour = String(kst.getUTCHours()).padStart(2, "0");
  const minute = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${month}/${date}(${day}) ${hour}:${minute}`;
}

/**
 * 슬롯 격자의 간격. generateUpcomingSlots의 기본 stepMinutes와 같은 값이어야 한다.
 */
export const SLOT_STEP_MINUTES = 30;

/** 업무시간(한국 기준). generateUpcomingSlots의 기본값과 같은 값이어야 한다. */
export const BUSINESS_START_HOUR = 9;
export const BUSINESS_END_HOUR = 18;

/**
 * 면접 유형별 실제 소요시간(분). 슬롯 격자(30분)의 배수여야 한다.
 *
 * 이 값이 없으면 시스템은 면접을 "격자 위의 한 점"으로만 다루게 되고, 10:00에
 * 확정된 1시간 면접의 10:30이 여전히 비어 있는 것으로 취급된다 — 같은 면접관에게
 * 10:30 면접이 또 잡히고, 매칭도 정합성 검사도 슬롯 문자열이 다르니 겹침으로
 * 보지 않는다. 소요시간을 여기 한 곳에 두고 점유·탐색·검사가 모두 이 값을
 * 기준으로 계산하게 해서 그 구멍을 막는다.
 */
export const INTERVIEW_DURATION_MINUTES: Record<string, number> = {
  "1차 대면": 60,
  "2차 대면": 60,
  온라인: 30,
  전화: 30,
};

/** 정의되지 않은 유형은 격자 한 칸으로 본다(기존 동작). */
export function interviewDurationMinutes(interviewType: string): number {
  return INTERVIEW_DURATION_MINUTES[interviewType] ?? SLOT_STEP_MINUTES;
}

/** 겹침 후보를 조회할 시간 창을 정할 때 쓴다(가장 긴 면접보다 앞선 건은 겹칠 수 없다). */
export const MAX_INTERVIEW_DURATION_MINUTES = Math.max(
  SLOT_STEP_MINUTES,
  ...Object.values(INTERVIEW_DURATION_MINUTES),
);

/**
 * 이 시간에 시작하는 면접이 실제로 점유하는 슬롯 키 전체를 반환한다.
 * 30분 면접이면 [시작], 1시간 면접이면 [시작, 시작+30분].
 */
export function occupiedSlots(startKey: string, durationMin: number): string[] {
  const count = Math.max(1, Math.ceil(durationMin / SLOT_STEP_MINUTES));
  const start = new Date(startKey).getTime();
  return Array.from({ length: count }, (_, i) =>
    new Date(start + i * SLOT_STEP_MINUTES * 60_000).toISOString(),
  );
}

/**
 * 면접이 시작부터 끝까지 업무시간 안에 들어오는지. 17:30에 시작하는 1시간 면접은
 * 18:30에 끝나므로 확정 대상이 될 수 없다 — 점유 슬롯만 확인하면 이 경우를
 * 놓치기 때문에(18:00 슬롯은 애초에 격자에 없어서 "비어 있음"으로 보인다) 시각을
 * 직접 계산해 판단한다.
 */
export function fitsInBusinessHours(
  startKey: string,
  durationMin: number,
  startHour = BUSINESS_START_HOUR,
  endHour = BUSINESS_END_HOUR,
): boolean {
  const kst = new Date(new Date(startKey).getTime() + KST_OFFSET_MS);
  const startMinutes = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  return startMinutes >= startHour * 60 && startMinutes + durationMin <= endHour * 60;
}

/**
 * 두 면접이 시간상 겹치는지. 슬롯 문자열이 같은지가 아니라 구간이 겹치는지를 본다
 * (10:00 1시간 면접과 10:30 면접은 문자열은 다르지만 겹친다). 끝나는 시각과
 * 시작하는 시각이 맞닿는 경우는 겹침이 아니다.
 */
export function interviewsOverlap(
  aStartKey: string,
  aDurationMin: number,
  bStartKey: string,
  bDurationMin: number,
): boolean {
  const aStart = new Date(aStartKey).getTime();
  const bStart = new Date(bStartKey).getTime();
  return aStart < bStart + bDurationMin * 60_000 && bStart < aStart + aDurationMin * 60_000;
}

/** 후보자·면접관이 끝나는 시각까지 알 수 있도록 "8/25(월) 10:00~11:00" 형태로 만든다. */
export function formatSlotRangeLabel(startKey: string, durationMin: number): string {
  const endKey = new Date(new Date(startKey).getTime() + durationMin * 60_000).toISOString();
  const endTime = formatSlotLabel(endKey).split(" ")[1];
  return `${formatSlotLabel(startKey)}~${endTime}`;
}
