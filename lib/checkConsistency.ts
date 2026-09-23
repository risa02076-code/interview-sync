import { SupabaseClient } from "@supabase/supabase-js";
import { requiresRoom } from "./matching";
import { sendEmail, emailErrorReason } from "./email";
import { computeInterviewerProgress } from "./interviewerProgress";
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
  | "candidate_double_booked"
  | "unnotified_past_slot"
  | "outside_business_hours"
  | "confirmed_without_response";

export type Violation = {
  interviewId: string;
  candidateName: string;
  kind: ViolationKind;
  detail: string;
};

export type ConsistencyCheckInterview = {
  id: string;
  candidate_name: string;
  candidate_email: string | null;
  interview_type: string;
  panel: string[];
  matched_slot: string | null;
  room_id: string | null;
  status: "confirmed" | "rescheduled" | "escalated" | "pending";
  confirmation_sent_at: string | null;
  /**
   * 확정된 시점 기준, 이 면접 요청(kind: "interviewer")에 아직 응답을 제출하지
   * 않은 패널 멤버 이름. 계산에 response_requests 조회가 필요해 호출부
   * (runConsistencyCheck·checkSingleInterviewViolations)가 채워 넣는다 — 값이
   * 없으면(undefined) 이 검사는 건너뛴다.
   */
  unrespondedPanelNames?: string[];
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

  // 자동 확정(confirmFromPriorities)은 전원 응답을 마쳐야만 실행되지만, 담당자가
  // 히트맵을 보고 직접 확정하는 경로(manual-confirm)는 그렇지 않다 — 미응답자가
  // 있어도 담당자가 "그래도 진행"을 선택하면 확정된다(lib/manualConfirmNote.ts).
  // 그 순간엔 확인 절차를 거치지만, 이후 새 확정 경로가 추가되거나 데이터가 직접
  // 수정되는 등 그 확인을 우회할 방법은 남아있다. 이 검사는 그 마지막 그물이다 —
  // "그때 확인했는지"가 아니라 "지금도 미응답 상태로 남아있는지"를 매일 다시 본다.
  for (const iv of confirmed) {
    if (iv.unrespondedPanelNames?.length) {
      violations.push({
        interviewId: iv.id,
        candidateName: iv.candidate_name,
        kind: "confirmed_without_response",
        detail: `확정됐지만 아직 응답하지 않은 면접관이 있음: ${iv.unrespondedPanelNames.join(", ")} — 이들의 '가능'은 답변이 아니라 침묵으로 추정한 것입니다`,
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

  // 같은 후보자가 서로 다른 면접 케이스 두 건에 겹치는 시간으로 확정되면 안 된다
  // — 사람은 동시에 두 면접에 있을 수 없다. findMatch(lib/matching.ts)는 면접관·
  // 면접실 겹침만 확인하고 "이 후보자가 다른 케이스에도 확정돼 있는지"는 애초에
  // 알 방법이 없다(면접 한 건씩만 보고 판단하는 구조라서) — 그래서 이 위반은
  // 매칭 단계가 아니라 여기(전체 데이터를 훑는 정합성 검사)에서만 잡을 수 있다.
  //
  // 이 스키마엔 후보자 고유 id가 없어, 이메일이 있으면 이메일로(더 정확한 신호),
  // 없으면 이름으로 묶는다 — 이메일이 다르면 동명이인이라도 애초에 같은 그룹으로
  // 안 묶여 오탐이 안 나고, 이메일이 없는 경우에만 이름만으로 판단하던 예전 동작이
  // 그대로 남는다(둘 중 하나라도 이메일이 없으면 대조할 수 없으니 이름으로 물러난다).
  const candidateKey = (iv: ConsistencyCheckInterview) =>
    iv.candidate_email?.trim().toLowerCase() || iv.candidate_name.trim();
  const byCandidate = new Map<string, ConsistencyCheckInterview[]>();
  for (const iv of confirmed) {
    const key = candidateKey(iv);
    const list = byCandidate.get(key) ?? [];
    list.push(iv);
    byCandidate.set(key, list);
  }
  for (const [, ivs] of byCandidate) {
    for (const iv of ivs) {
      const clashes = ivs.filter((other) => other.id !== iv.id && overlapping(iv, other));
      if (!clashes.length) continue;
      violations.push({
        interviewId: iv.id,
        candidateName: iv.candidate_name,
        kind: "candidate_double_booked",
        detail: `같은 후보자가 서로 다른 면접에 겹치는 시간으로 확정됨 — ${describe(iv)} ↔ ${clashes
          .map(describe)
          .join(", ")}`,
      });
    }
  }

  return violations;
}

/**
 * confirmed_without_response 검사에 필요한 "이 면접에 아직 응답 안 한 패널"을
 * response_requests 조회로 채워 넣는다. findConsistencyViolations 자체는 이
 * 조회 없이 순수하게 남겨두고(테스트가 가짜 데이터로 바로 검증할 수 있도록),
 * DB 접근이 필요한 이 부분만 호출부 공용으로 뺐다.
 */
async function withUnrespondedPanel(
  supabase: SupabaseClient,
  interviews: ConsistencyCheckInterview[],
): Promise<ConsistencyCheckInterview[]> {
  const relevant = interviews.filter((iv) => iv.status === "confirmed" || iv.status === "rescheduled");
  if (!relevant.length) return interviews;

  const interviewIds = relevant.map((iv) => iv.id);
  const panelIds = [...new Set(relevant.flatMap((iv) => iv.panel))];

  const [{ data: interviewers }, { data: requests }] = await Promise.all([
    supabase.from("interviewers").select("id,name").in("id", panelIds),
    supabase
      .from("response_requests")
      .select("interview_id,interviewer_id,status,created_at")
      .eq("kind", "interviewer")
      .in("interview_id", interviewIds),
  ]);

  const nameById = new Map((interviewers ?? []).map((p) => [p.id, p.name as string]));
  const requestsByInterview = new Map<string, { interviewer_id: string | null; status: string; created_at: string }[]>();
  for (const r of requests ?? []) {
    const list = requestsByInterview.get(r.interview_id) ?? [];
    list.push(r);
    requestsByInterview.set(r.interview_id, list);
  }

  return interviews.map((iv) => {
    if (iv.status !== "confirmed" && iv.status !== "rescheduled") return iv;
    const progress = computeInterviewerProgress(iv.panel, requestsByInterview.get(iv.id) ?? []);
    const unrespondedPanelNames = iv.panel
      .filter((pid) => !progress.respondedIds.has(pid))
      .map((pid) => nameById.get(pid) ?? pid);
    return { ...iv, unrespondedPanelNames };
  });
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
      .select("id,candidate_name,candidate_email,interview_type,panel,matched_slot,room_id,status,confirmation_sent_at")
      .gte("matched_slot", windowFrom)
      .lte("matched_slot", windowTo)
      .in("status", ["confirmed", "rescheduled"])
      .neq("id", interview.id);
    if (error) throw error;
    peers = (data ?? []) as ConsistencyCheckInterview[];
  }

  const withResponses = await withUnrespondedPanel(supabase, [interview, ...peers]);
  return findConsistencyViolations(withResponses).filter((v) => v.interviewId === interview.id);
}

/**
 * 매일 1회 크론이 호출한다(vercel.json 참고). 위반이 있으면 각 케이스의 note에
 * 남겨 대시보드에서 바로 보이게 하고, 담당자 메일로도 요약을 보낸다 — 위반이
 * 없으면 조용히 끝난다(리마인더 크론과 같은 방식).
 */
export async function runConsistencyCheck(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("interviews")
    .select("id,candidate_name,candidate_email,interview_type,panel,matched_slot,room_id,status,confirmation_sent_at");
  if (error) throw error;

  const withResponses = await withUnrespondedPanel(supabase, (data ?? []) as ConsistencyCheckInterview[]);
  const violations = findConsistencyViolations(withResponses);

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
