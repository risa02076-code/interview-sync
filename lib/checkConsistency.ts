import { SupabaseClient } from "@supabase/supabase-js";
import { requiresRoom } from "./matching";
import { sendEmail, emailErrorReason } from "./email";
import {
  MAX_INTERVIEW_DURATION_MINUTES,
  fitsInBusinessHours,
  formatSlotRangeLabel,
  interviewDurationMinutes,
  interviewsOverlap,
} from "./slots";

export type ViolationKind =
  | "status_slot_mismatch"
  | "missing_room"
  | "unexpected_room"
  | "interviewer_double_booked"
  | "room_double_booked"
  | "unnotified_past_slot"
  | "outside_business_hours";

export type Violation = {
  interviewId: string;
  candidateName: string;
  kind: ViolationKind;
  detail: string;
};

export type ConsistencyCheckInterview = {
  id: string;
  candidate_name: string;
  interview_type: string;
  panel: string[];
  matched_slot: string | null;
  room_id: string | null;
  status: "confirmed" | "rescheduled" | "escalated" | "pending";
  confirmation_sent_at: string | null;
};

/**
 * findMatch(lib/matching.ts)는 쓰는 시점에 이미 "겹치는 면접관/면접실이 없어야만
 * 확정"을 보장한다. 이 함수는 매칭 로직 자체를 다시 확인하는 게 아니라(그건
 * matching.test.ts가 가짜 시나리오로 이미 함), 확정 이후 다른 경로에서 그 보장이
 * 실제로 깨졌는지를 지금 저장된 진짜 데이터에서 확인한다.
 */
export function findConsistencyViolations(
  interviews: ConsistencyCheckInterview[],
  now: Date = new Date(),
): Violation[] {
  const violations: Violation[] = [];

  for (const iv of interviews) {
    const shouldHaveSlot = iv.status === "confirmed" || iv.status === "rescheduled";
    if (shouldHaveSlot && !iv.matched_slot) {
      violations.push({
        interviewId: iv.id,
        candidateName: iv.candidate_name,
        kind: "status_slot_mismatch",
        detail: `상태는 '${iv.status}'인데 확정된 시간이 없음`,
      });
    }
    if (!shouldHaveSlot && iv.matched_slot) {
      violations.push({
        interviewId: iv.id,
        candidateName: iv.candidate_name,
        kind: "status_slot_mismatch",
        detail: `상태는 '${iv.status}'인데 확정된 시간(${iv.matched_slot})이 남아있음`,
      });
    }
  }

  const confirmed = interviews.filter(
    (iv) => (iv.status === "confirmed" || iv.status === "rescheduled") && iv.matched_slot,
  );

  // "확정 시간이 과거"인 것 자체는 정상이다(면접이 끝난 것뿐 — lib/status.ts의
  // "completed" 표시가 바로 이 경우). 문제가 되는 건 그 시간이 지날 때까지
  // 확정 메일이 끝내 나가지 않은 경우뿐이라, confirmation_sent_at이 없을 때만 잡는다.
  for (const iv of confirmed) {
    if (!iv.confirmation_sent_at && iv.matched_slot && new Date(iv.matched_slot).getTime() < now.getTime()) {
      violations.push({
        interviewId: iv.id,
        candidateName: iv.candidate_name,
        kind: "unnotified_past_slot",
        detail: `확정된 시간(${iv.matched_slot})이 이미 지났는데 확정 메일이 발송되지 않음`,
      });
    }
  }

  for (const iv of confirmed) {
    const needsRoom = requiresRoom(iv.interview_type);
    if (needsRoom && !iv.room_id) {
      violations.push({
        interviewId: iv.id,
        candidateName: iv.candidate_name,
        kind: "missing_room",
        detail: `${iv.interview_type} 면접인데 면접실이 배정되지 않음`,
      });
    }
    if (!needsRoom && iv.room_id) {
      violations.push({
        interviewId: iv.id,
        candidateName: iv.candidate_name,
        kind: "unexpected_room",
        detail: `${iv.interview_type} 면접인데 면접실(${iv.room_id})이 배정되어 있음`,
      });
    }
  }

  // 면접이 업무시간을 넘겨 끝나는 경우. 소요시간을 다루기 전에는 정의할 수 없던
  // 위반이다 — 17:30에 확정된 1시간 면접은 시작 슬롯만 보면 정상으로 보인다.
  for (const iv of confirmed) {
    const duration = interviewDurationMinutes(iv.interview_type);
    if (iv.matched_slot && !fitsInBusinessHours(iv.matched_slot, duration)) {
      violations.push({
        interviewId: iv.id,
        candidateName: iv.candidate_name,
        kind: "outside_business_hours",
        detail: `${iv.interview_type} 면접(${duration}분)이 업무시간을 넘겨 끝남: ${formatSlotRangeLabel(
          iv.matched_slot,
          duration,
        )}`,
      });
    }
  }

  // 겹침은 슬롯 문자열이 같은지가 아니라 시간 구간이 겹치는지로 판단한다. 문자열
  // 일치로만 보면 10:00에 확정된 1시간 면접과 10:30 면접을 서로 다른 시간으로
  // 취급해 이중 배정을 그대로 통과시킨다.
  const overlapping = (a: ConsistencyCheckInterview, b: ConsistencyCheckInterview) =>
    interviewsOverlap(
      a.matched_slot as string,
      interviewDurationMinutes(a.interview_type),
      b.matched_slot as string,
      interviewDurationMinutes(b.interview_type),
    );

  const describe = (iv: ConsistencyCheckInterview) =>
    `${iv.candidate_name}(${formatSlotRangeLabel(
      iv.matched_slot as string,
      interviewDurationMinutes(iv.interview_type),
    )})`;

  const byInterviewer = new Map<string, ConsistencyCheckInterview[]>();
  for (const iv of confirmed) {
    for (const interviewerId of iv.panel) {
      const list = byInterviewer.get(interviewerId) ?? [];
      list.push(iv);
      byInterviewer.set(interviewerId, list);
    }
  }
  for (const [interviewerId, ivs] of byInterviewer) {
    for (const iv of ivs) {
      const clashes = ivs.filter((other) => other.id !== iv.id && overlapping(iv, other));
      if (!clashes.length) continue;
      violations.push({
        interviewId: iv.id,
        candidateName: iv.candidate_name,
        kind: "interviewer_double_booked",
        detail: `면접관(${interviewerId})의 면접 시간이 겹침 — ${describe(iv)} ↔ ${clashes
          .map(describe)
          .join(", ")}`,
      });
    }
  }

  const byRoom = new Map<string, ConsistencyCheckInterview[]>();
  for (const iv of confirmed) {
    if (!iv.room_id) continue;
    const list = byRoom.get(iv.room_id) ?? [];
    list.push(iv);
    byRoom.set(iv.room_id, list);
  }
  for (const [, ivs] of byRoom) {
    for (const iv of ivs) {
      const clashes = ivs.filter((other) => other.id !== iv.id && overlapping(iv, other));
      if (!clashes.length) continue;
      violations.push({
        interviewId: iv.id,
        candidateName: iv.candidate_name,
        kind: "room_double_booked",
        detail: `면접실 사용 시간이 겹침 — ${describe(iv)} ↔ ${clashes.map(describe).join(", ")}`,
      });
    }
  }

  return violations;
}

/**
 * 확정 메일을 실제로 보내기 직전(sendConfirmationEmail)에, 이 면접 하나만 콕 집어
 * 확인한다. runConsistencyCheck처럼 전체 interviews 테이블을 다 훑는 게 아니라,
 * "이 면접과 시간이 겹칠 수 있는 건들"만 조회해서 비교 대상을 좁힌다.
 *
 * 조회 창은 [시작 - 가장 긴 면접 시간, 시작 + 이 면접 시간]이다. 이보다 앞서
 * 시작한 면접은 아무리 길어도 이 면접이 시작하기 전에 끝나고, 이보다 늦게 시작한
 * 면접은 이 면접이 끝난 뒤에 시작하므로 겹칠 수 없다. 겹침 여부 자체는 조회 결과를
 * findConsistencyViolations에 넘겨 판단하므로, 창을 넉넉히 잡아 후보를 더 가져오는
 * 것은 안전하다(놓치는 것만 위험하다).
 */
export async function checkSingleInterviewViolations(
  supabase: SupabaseClient,
  interview: ConsistencyCheckInterview,
): Promise<Violation[]> {
  let peers: ConsistencyCheckInterview[] = [];

  const shouldHaveSlot = interview.status === "confirmed" || interview.status === "rescheduled";
  if (shouldHaveSlot && interview.matched_slot) {
    const start = new Date(interview.matched_slot).getTime();
    const windowFrom = new Date(start - MAX_INTERVIEW_DURATION_MINUTES * 60_000).toISOString();
    const windowTo = new Date(
      start + interviewDurationMinutes(interview.interview_type) * 60_000,
    ).toISOString();

    const { data, error } = await supabase
      .from("interviews")
      .select("id,candidate_name,interview_type,panel,matched_slot,room_id,status,confirmation_sent_at")
      .gte("matched_slot", windowFrom)
      .lte("matched_slot", windowTo)
      .in("status", ["confirmed", "rescheduled"])
      .neq("id", interview.id);
    if (error) throw error;
    peers = (data ?? []) as ConsistencyCheckInterview[];
  }

  return findConsistencyViolations([interview, ...peers]).filter((v) => v.interviewId === interview.id);
}

/**
 * 매일 1회 크론이 호출한다(vercel.json 참고). 위반이 있으면 각 케이스의 note에
 * 남겨 대시보드에서 바로 보이게 하고, 담당자 메일로도 요약을 보낸다 — 위반이
 * 없으면 조용히 끝난다(리마인더 크론과 같은 방식).
 */
export async function runConsistencyCheck(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("interviews")
    .select("id,candidate_name,interview_type,panel,matched_slot,room_id,status,confirmation_sent_at");
  if (error) throw error;

  const violations = findConsistencyViolations((data ?? []) as ConsistencyCheckInterview[]);

  for (const v of violations) {
    await supabase
      .from("interviews")
      .update({ note: `🚨 데이터 정합성 오류: ${v.detail}` })
      .eq("id", v.interviewId);
  }

  if (violations.length) {
    const admin = process.env.GMAIL_USER;
    if (admin) {
      const body = `
        <p>정합성 검사에서 ${violations.length}건의 모순이 발견됐습니다.</p>
        <ul>${violations.map((v) => `<li>${v.candidateName} — ${v.detail}</li>`).join("")}</ul>
      `;
      try {
        await sendEmail(admin, `[인터뷰싱크] 데이터 정합성 오류 ${violations.length}건 발견`, body);
      } catch (e) {
        console.error(`[consistency-check-alert-failed] ${emailErrorReason(e)}`);
      }
    }
  }

  return violations;
}
