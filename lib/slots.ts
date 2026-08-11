export type Slot = { key: string; label: string };

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

/**
 * 오늘(또는 from) 기준 다음 영업일(주말 제외) N일 동안, 업무시간(기본 09~18시)을
 * step분(기본 30분) 단위로 잘라 후보 슬롯으로 생성한다(when2meet처럼 30분 단위 그리드).
 * 하드코딩된 날짜 목록 대신 매번 "현재" 기준으로 계산된다.
 */
export function generateUpcomingSlots(
  businessDays = 5,
  startHour = 9,
  endHour = 18,
  stepMinutes = 30,
  from: Date = new Date(),
): Slot[] {
  const slots: Slot[] = [];
  const cursor = new Date(from);
  cursor.setHours(0, 0, 0, 0);
  cursor.setDate(cursor.getDate() + 1); // 내일부터 제안

  let daysAdded = 0;
  while (daysAdded < businessDays) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) {
      for (let minutes = startHour * 60; minutes < endHour * 60; minutes += stepMinutes) {
        const dt = new Date(cursor);
        dt.setHours(0, minutes, 0, 0);
        slots.push({ key: dt.toISOString(), label: formatSlotLabel(dt.toISOString()) });
      }
      daysAdded += 1;
    }
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
}

/** 저장된 슬롯 키(ISO 문자열)를 사람이 읽는 라벨로 변환한다. 과거 슬롯도 그대로 표시 가능. */
export function formatSlotLabel(key: string): string {
  const dt = new Date(key);
  const month = dt.getMonth() + 1;
  const date = dt.getDate();
  const day = DAY_NAMES[dt.getDay()];
  const hour = String(dt.getHours()).padStart(2, "0");
  const minute = String(dt.getMinutes()).padStart(2, "0");
  return `${month}/${date}(${day}) ${hour}:${minute}`;
}
