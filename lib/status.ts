import { kstDayKey } from "./slots";

export type DisplayStatus =
  | "awaiting_interviewer"
  | "awaiting_candidate"
  | "awaiting_recruiter_pick"
  | "awaiting_priority_confirm"
  | "needs_reschedule"
  | "coordinated"
  | "confirmed"
  | "completed";

type InterviewLike = {
  status: "confirmed" | "rescheduled" | "escalated" | "pending";
  stage:
    | "created"
    | "interviewer_pending"
    | "interviewer_done"
    | "candidate_pending"
    | "candidate_done"
    | "priority_confirm_pending";
  matched_slot: string | null;
  confirmation_sent_at: string | null;
};

/**
 * 실무 채용 프로세스에 맞춰 세분화한 표시용 상태.
 * status(매칭 결과)·stage(이메일 진행 단계)·confirmation_sent_at(최종 확정 메일 발송 여부)를
 * 조합해서 하나의 상태로 도출한다.
 */
export function deriveDisplayStatus(iv: InterviewLike): DisplayStatus {
  if (iv.status === "escalated") return "needs_reschedule";

  if (iv.status === "pending") {
    if (iv.stage === "created" || iv.stage === "interviewer_pending") return "awaiting_interviewer";
    // 후보자가 1~3순위를 제출한 뒤 면접관 전원에게 참석 가능 여부를 확인받는 중
    if (iv.stage === "priority_confirm_pending") return "awaiting_priority_confirm";
    // 순위는 제출됐지만 아직 확인 요청이 나가기 전(거의 순간적으로 지나가는 상태) — 안전장치
    if (iv.stage === "candidate_done") return "awaiting_recruiter_pick";
    return "awaiting_candidate"; // interviewer_done(발송 직전) 또는 candidate_pending
  }

  // confirmed | rescheduled — 매칭은 됐지만 최종 확정 메일 발송 여부·면접 시점에 따라 갈린다
  if (iv.matched_slot && new Date(iv.matched_slot).getTime() < Date.now()) return "completed";
  if (iv.confirmation_sent_at) return "confirmed";
  return "coordinated";
}

export const STATUS_META: Record<
  DisplayStatus,
  { label: string; emoji: string; badgeClass: string }
> = {
  awaiting_interviewer: {
    label: "면접관 응답 대기",
    emoji: "🟡",
    badgeClass: "bg-amber-100 text-amber-800 border-amber-300",
  },
  awaiting_candidate: {
    label: "후보자 응답 대기",
    emoji: "🟡",
    badgeClass: "bg-amber-100 text-amber-800 border-amber-300",
  },
  awaiting_recruiter_pick: {
    label: "리크루터 확정 필요",
    emoji: "🟣",
    badgeClass: "bg-purple-100 text-purple-800 border-purple-300",
  },
  awaiting_priority_confirm: {
    label: "면접관 최종 확인 중",
    emoji: "🟣",
    badgeClass: "bg-purple-100 text-purple-800 border-purple-300",
  },
  needs_reschedule: {
    label: "재조율 필요",
    emoji: "🟠",
    badgeClass: "bg-orange-100 text-orange-800 border-orange-300",
  },
  coordinated: {
    label: "조율 완료",
    emoji: "🔵",
    badgeClass: "bg-blue-100 text-blue-800 border-blue-300",
  },
  confirmed: {
    label: "확정",
    emoji: "🟢",
    badgeClass: "bg-green-100 text-green-800 border-green-300",
  },
  completed: {
    label: "면접 종료",
    emoji: "⚫",
    badgeClass: "bg-neutral-200 text-neutral-600 border-neutral-300",
  },
};

/**
 * 매칭된 슬롯까지 남은 일수를 D-day 형태로 표시. 매칭 전이면 null.
 *
 * "며칠 남았는지"는 한국 날짜 기준으로 센다. 로컬 getter를 쓰면 보는 사람의
 * 시간대에 따라 D-3이 D-2로 보이는 등 하루가 어긋난다(한국 아침 09:00 면접은
 * UTC로는 아직 전날이다).
 */
export function dDayLabel(matchedSlot: string | null, now: Date = new Date()): string | null {
  if (!matchedSlot) return null;
  const diffDays = Math.round(
    (Date.parse(`${kstDayKey(matchedSlot)}T00:00:00.000Z`) -
      Date.parse(`${kstDayKey(now)}T00:00:00.000Z`)) /
      86_400_000,
  );
  if (diffDays < 0) return "종료";
  return `D-${diffDays}`;
}
