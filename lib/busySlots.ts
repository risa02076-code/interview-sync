import { formatSlotLabel, kstDayKey } from "./slots";

/**
 * 불가능 시간을 한 줄로 다 늘어놓지 않고 날짜별로 묶어서 보여주기 위함.
 *
 * 날짜·시간 표기는 formatSlotLabel(한국 시간 고정)에 맡긴다. 예전에는 Date의
 * getHours/getDate 같은 로컬 getter를 썼는데, 그 값은 실행 환경의 타임존을 그대로
 * 따른다 — 한국에서 개발할 때는 맞아 보이고 UTC로 도는 서버에서만 9시간 어긋난다
 * (lib/slots.ts의 KST_OFFSET_MS 주석과 같은 문제).
 */
export function groupBusySlotsByDay(busySlots: string[]) {
  const order: string[] = [];
  const labels = new Map<string, string>();
  const times = new Map<string, string[]>();

  for (const key of [...busySlots].sort()) {
    const dayKey = kstDayKey(key);
    // "8/25(월) 10:30" → ["8/25(월)", "10:30"]
    const [dayLabel, time] = formatSlotLabel(key).split(" ");
    if (!times.has(dayKey)) {
      order.push(dayKey);
      labels.set(dayKey, dayLabel);
      times.set(dayKey, []);
    }
    times.get(dayKey)!.push(time);
  }

  return order.map((dayKey) => ({ dayLabel: labels.get(dayKey)!, times: times.get(dayKey)! }));
}

/** 응답 시각을 "8/11 16:20" 형태로 짧게 표시하기 위함(요일은 떼고 보여준다). */
export function formatRespondedAt(iso: string | null) {
  if (!iso) return null;
  return formatSlotLabel(iso).replace(/\([^)]*\)/, "");
}
