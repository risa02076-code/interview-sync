export type InterviewerDetail = { id: string; name: string; role: string; responded: boolean };

export type InterviewRow = {
  id: string;
  candidate_name: string;
  candidate_email: string | null;
  position: string;
  interview_type: string;
  panelDetail: InterviewerDetail[];
  preferred_slots: string[];
  matched_slot: string | null;
  roomName: string | null;
  status: "confirmed" | "rescheduled" | "escalated" | "pending";
  stage: "created" | "interviewer_pending" | "interviewer_done" | "candidate_pending" | "candidate_done";
  interviewerProgress: { submitted: number; total: number };
  candidateResponded: boolean;
  confirmation_sent_at: string | null;
  note: string | null;
};

export type CalendarColor = "green" | "yellow" | "red";

/** Week/Day 캘린더 전용 3색 코딩. 6단계 대시보드 상태와는 별개로,
 *  일정에 색을 칠할 때 요청받은 대로 확정/조율중/재조율 3가지로만 단순화한다. */
export function calendarColor(iv: InterviewRow): CalendarColor {
  if (iv.status === "rescheduled") return "red";
  if (iv.confirmation_sent_at) return "green";
  return "yellow";
}

export const CAL_COLOR_CLASS: Record<CalendarColor, string> = {
  green: "bg-green-50 border-green-300 text-green-800 hover:bg-green-100",
  yellow: "bg-amber-50 border-amber-300 text-amber-800 hover:bg-amber-100",
  red: "bg-red-50 border-red-300 text-red-800 hover:bg-red-100",
};

export const CAL_COLOR_LABEL: Record<CalendarColor, string> = {
  green: "확정",
  yellow: "조율중",
  red: "재조율",
};

export const HOURS = Array.from({ length: 10 }, (_, i) => 9 + i); // 09..18
const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

export function startOfWeek(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function dayLabel(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}(${DAY_NAMES[d.getDay()]})`;
}

export function dateRangeLabel(start: Date, end: Date): string {
  return `${start.getMonth() + 1}/${start.getDate()} - ${end.getMonth() + 1}/${end.getDate()}`;
}
