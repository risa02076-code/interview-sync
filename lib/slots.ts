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
