import { kstShifted } from "@/lib/slots";

export type InterviewerDetail = {
  id: string;
  name: string;
  role: string;
  responded: boolean;
  emailSentAt: string | null;
};

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
  stage:
    | "created"
    | "interviewer_pending"
    | "interviewer_done"
    | "candidate_pending"
    | "candidate_done"
    | "priority_confirm_pending";
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

/**
 * 이 캘린더의 모든 날짜 계산은 "한국 시간으로 9시간 시프트한 Date"를 쓰고 UTC
 * getter로만 읽는다(lib/slots.ts의 kstShifted와 같은 규칙).
 *
 * 로컬 getter를 쓰면 보는 사람의 시간대에 따라 주 시작일과 이벤트가 놓이는 칸이
 * 달라진다 — 담당자가 해외에서 열면 한국 기준 월요일 09:00 면접이 일요일 밤
 * 칸으로 밀려서, 캘린더가 실제 일정과 다른 그림을 보여준다.
 *
 * 이름에 Kst가 붙은 값끼리만 비교한다. 시프트된 Date와 시프트하지 않은 Date를
 * 섞으면 9시간이 두 번 어긋난다.
 */
export function kstNow(): Date {
  return kstShifted(new Date());
}

/** 시프트된 Date를 받아 그 주의 월요일 자정(한국 기준)을 시프트된 Date로 돌려준다. */
export function startOfWeek(kstDate: Date): Date {
  const d = new Date(kstDate);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function addDays(kstDate: Date, n: number): Date {
  const d = new Date(kstDate);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

/** 시프트된 Date 두 개가 한국 기준 같은 날인지 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/** 시프트된 Date와 저장된 슬롯 키(UTC ISO)가 한국 기준 같은 날인지 */
export function isSameDayAsSlot(kstDate: Date, slotKey: string): boolean {
  return isSameDay(kstDate, kstShifted(slotKey));
}

export function dayLabel(kstDate: Date): string {
  return `${kstDate.getUTCMonth() + 1}/${kstDate.getUTCDate()}(${DAY_NAMES[kstDate.getUTCDay()]})`;
}

export function dateRangeLabel(start: Date, end: Date): string {
  return `${start.getUTCMonth() + 1}/${start.getUTCDate()} - ${end.getUTCMonth() + 1}/${end.getUTCDate()}`;
}
