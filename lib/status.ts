export type DisplayStatus =
  | "awaiting_interviewer"
  | "awaiting_candidate"
  | "needs_reschedule"
  | "coordinated"
  | "confirmed"
  | "completed";

type InterviewLike = {
  status: "confirmed" | "rescheduled" | "escalated" | "pending";
  stage: "created" | "interviewer_pending" | "interviewer_done" | "candidate_pending" | "candidate_done";
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

/** 매칭된 슬롯까지 남은 일수를 D-day 형태로 표시. 매칭 전이면 null. */
export function dDayLabel(matchedSlot: string | null): string | null {
  if (!matchedSlot) return null;
  const now = new Date();
  const target = new Date(matchedSlot);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate());
  const diffDays = Math.round((startOfTarget.getTime() - startOfToday.getTime()) / 86_400_000);
  if (diffDays < 0) return "종료";
  return `D-${diffDays}`;
}
