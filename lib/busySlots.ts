const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

/** 불가능 시간을 한 줄로 다 늘어놓지 않고 날짜별로 묶어서 보여주기 위함 */
export function groupBusySlotsByDay(busySlots: string[]) {
  const order: string[] = [];
  const labels = new Map<string, string>();
  const times = new Map<string, string[]>();

  for (const key of [...busySlots].sort()) {
    const dt = new Date(key);
    const dayKey = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
    if (!times.has(dayKey)) {
      order.push(dayKey);
      labels.set(dayKey, `${dt.getMonth() + 1}/${dt.getDate()}(${DAY_NAMES[dt.getDay()]})`);
      times.set(dayKey, []);
    }
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    times.get(dayKey)!.push(`${hh}:${mm}`);
  }

  return order.map((dayKey) => ({ dayLabel: labels.get(dayKey)!, times: times.get(dayKey)! }));
}

/** 응답 시각을 "8/11 16:20" 형태로 짧게 표시하기 위함 */
export function formatRespondedAt(iso: string | null) {
  if (!iso) return null;
  const dt = new Date(iso);
  const hh = String(dt.getHours()).padStart(2, "0");
  const mm = String(dt.getMinutes()).padStart(2, "0");
  return `${dt.getMonth() + 1}/${dt.getDate()} ${hh}:${mm}`;
}
