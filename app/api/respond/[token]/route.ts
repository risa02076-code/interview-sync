import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateUpcomingSlots, formatSlotLabel } from "@/lib/slots";
import { sendCandidateInvite } from "@/lib/sendCandidateInvite";
import { sendInterviewerInvites } from "@/lib/sendInterviewerInvites";
import { recommendLeastConflictSlots, requiresRoom } from "@/lib/matching";
import { requestMoreAvailability, MAX_AVAILABILITY_ROUNDS } from "@/lib/requestMoreAvailability";
import { requestPriorityConfirmation } from "@/lib/requestPriorityConfirmation";
import { confirmFromPriorities } from "@/lib/confirmFromPriorities";

type Params = { params: Promise<{ token: string }> };

/** 일정 변경 요청 시, 후보자에게 얼마나 넓은 기간(영업일)을 보여주고 체크하게 할지.
 * 이번 주 + 다음 주 정도를 커버하도록 잡았다. */
const RESCHEDULE_AVAILABILITY_BUSINESS_DAYS = 10;

export async function GET(_request: Request, { params }: Params) {
  const { token } = await params;
  const supabase = createAdminClient();

  const { data: reqRow, error } = await supabase
    .from("response_requests")
    .select("*")
    .eq("token", token)
    .single();
  if (error) return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });

  if (reqRow.kind === "candidate") {
    const { data: interview } = await supabase
      .from("interviews")
      .select("candidate_name, position, panel, interview_type, availability_round, excluded_slots")
      .eq("id", reqRow.interview_id)
      .single();

    // 이메일 발송 시점에 고정해둔 값을 보여주지 않고, 후보자가 응답을 미루는 동안 면접관
    // 일정이 바뀔 수 있으므로 지금 이 순간 기준으로 다시 계산한다. 후보자에게는 절대
    // 충돌 있는 시간을 보여주지 않으므로, 완전히 겹치지 않는 시간만 남긴다. 후보자가
    // 이미 "이 시간은 안 된다"고 요청했던 시간(excluded_slots)은 다시 추천하지 않는다.
    let slots: { key: string; label: string }[] = [];
    if (interview) {
      const { data: panelInterviewers } = await supabase
        .from("interviewers")
        .select("*")
        .in("id", interview.panel);
      const needsRoom = requiresRoom(interview.interview_type);
      const { data: rooms } = needsRoom ? await supabase.from("rooms").select("*") : { data: [] };
      const businessDays = interview.availability_round * 5;

      slots = recommendLeastConflictSlots(
        panelInterviewers ?? [],
        rooms ?? [],
        needsRoom,
        businessDays,
        interview.excluded_slots ?? [],
      )
        .filter((r) => r.conflicts.length === 0)
        .map((r) => ({ key: r.slot, label: formatSlotLabel(r.slot) }));
    }

    return NextResponse.json({
      kind: "candidate",
      status: reqRow.status,
      name: interview?.candidate_name,
      subtitle: interview?.position,
      slots,
    });
  }

  if (reqRow.kind === "candidate_wide_availability") {
    const { data: interview } = await supabase
      .from("interviews")
      .select("candidate_name, position")
      .eq("id", reqRow.interview_id)
      .single();

    // "다음 주" — 오늘부터 7일 뒤를 기준으로 영업일 5일(1주)을 새로 계산한다.
    const nextWeekFrom = new Date();
    nextWeekFrom.setDate(nextWeekFrom.getDate() + 7);

    return NextResponse.json({
      kind: "candidate_wide_availability",
      status: reqRow.status,
      name: interview?.candidate_name,
      subtitle: interview?.position,
      slots: generateUpcomingSlots(5, 9, 18, 30, nextWeekFrom),
    });
  }

  if (reqRow.kind === "reschedule_request") {
    const { data: interview } = await supabase
      .from("interviews")
      .select("candidate_name, position, matched_slot, status")
      .eq("id", reqRow.interview_id)
      .single();

    return NextResponse.json({
      kind: "reschedule_request",
      status: reqRow.status,
      name: interview?.candidate_name,
      subtitle: interview?.position,
      // 이미 다른 경로로 재조율이 시작된 뒤라면(더 이상 confirmed가 아님) 다시 누를 필요가 없다고 알려준다
      currentSlotLabel:
        interview?.status === "confirmed" && interview.matched_slot
          ? formatSlotLabel(interview.matched_slot)
          : null,
      // 후보자가 가능한 시간을 넓게 체크하게 한다 — 면접관 데이터와 바로 대조해서
      // 겹치는 시간이 있으면 다시 물어보지 않고 곧바로 확정할 수 있게 하기 위함이다.
      slots: generateUpcomingSlots(RESCHEDULE_AVAILABILITY_BUSINESS_DAYS),
    });
  }

  if (reqRow.kind === "priority_confirm") {
    const { data: interview } = await supabase
      .from("interviews")
      .select("candidate_name, position")
      .eq("id", reqRow.interview_id)
      .single();
    const { data: interviewer } = await supabase
      .from("interviewers")
      .select("name, role, busy_slots")
      .eq("id", reqRow.interviewer_id)
      .single();

    const confirmSlots = (reqRow.confirm_slots as string[] | null) ?? [];
    return NextResponse.json({
      kind: "priority_confirm",
      status: reqRow.status,
      name: interviewer?.name,
      subtitle: interviewer?.role,
      candidateName: interview?.candidate_name,
      position: interview?.position,
      slots: confirmSlots.map((key) => ({ key, label: formatSlotLabel(key) })),
      // 이미 이 시간이 불가능하다고 표시돼 있으면 기본값으로 "불가능"에 맞춰 보여준다
      alreadyBusy: confirmSlots.filter((s) => (interviewer?.busy_slots ?? []).includes(s)),
    });
  }

  const { data: interviewer } = await supabase
    .from("interviewers")
    .select("name, role, busy_slots")
    .eq("id", reqRow.interviewer_id)
    .single();

  const { data: interviewRow } = reqRow.interview_id
    ? await supabase.from("interviews").select("panel, availability_round").eq("id", reqRow.interview_id).single()
    : { data: null };
  const businessDays = interviewRow ? interviewRow.availability_round * 5 : 5;

  // 이미 응답을 마친 다른 패널원이 불가능하다고 표시한 시간은 참고용으로 같이 보여준다
  // (내가 뭘 고르든 이미 죽은 시간대라는 걸 미리 알 수 있게).
  let othersBusy: string[] = [];
  if (interviewRow?.panel) {
    const otherIds = (interviewRow.panel as string[]).filter((pid) => pid !== reqRow.interviewer_id);
    if (otherIds.length) {
      const { data: submittedOthers } = await supabase
        .from("response_requests")
        .select("interviewer_id")
        .eq("interview_id", reqRow.interview_id)
        .eq("kind", "interviewer")
        .eq("status", "submitted")
        .in("interviewer_id", otherIds);
      const respondedIds = (submittedOthers ?? []).map((r) => r.interviewer_id);
      if (respondedIds.length) {
        const { data: others } = await supabase
          .from("interviewers")
          .select("busy_slots")
          .in("id", respondedIds);
        othersBusy = [...new Set((others ?? []).flatMap((o) => o.busy_slots as string[]))];
      }
    }
  }

  return NextResponse.json({
    kind: "interviewer",
    status: reqRow.status,
    name: interviewer?.name,
    subtitle: interviewer?.role,
    slots: generateUpcomingSlots(businessDays),
    preSelected: interviewer?.busy_slots ?? [],
    othersBusy,
  });
}

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const { selectedSlots, preferredSlots, allUnavailable, availableSlots, candidateNote } = (await request.json()) as {
    selectedSlots?: string[];
    preferredSlots?: string[];
    allUnavailable?: boolean;
    availableSlots?: string[];
    // kind='candidate_wide_availability'일 때만 사용: 다음 주도 어렵다는 후보자가 자유
    // 형식으로 남긴 "가능한 시점/사유". 매칭 엔진이 처리할 수 없는 예외라 리크루터에게
    // 그대로 넘긴다.
    candidateNote?: string;
  };

  const supabase = createAdminClient();
  const { data: reqRow, error } = await supabase
    .from("response_requests")
    .select("*")
    .eq("token", token)
    .single();
  if (error) return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });
  // 면접관 응답 링크(불가능 시간 표시, 우선순위 확인 모두)는 1회용으로 막지 않는다 —
  // 나중에 일정이 더 생기면 같은 링크에서 언제든 다시 고쳐 제출할 수 있어야 한다.
  // 후보자 응답만 1회로 제한한다.
  if (reqRow.status === "submitted" && reqRow.kind === "candidate") {
    return NextResponse.json({ error: "이미 제출된 응답입니다." }, { status: 400 });
  }

  if (reqRow.kind === "candidate" && allUnavailable) {
    // 제안된 시간이 전부 안 맞는다는 응답 — 면접관을 다시 들쑤시는 대신, 이 같은
    // 링크에서 후보자에게 다음 주 가능한 시간을 직접 체크하게 한다(재조율 흐름과
    // 동일한 사상: 후보자 쪽 제약이 원인이니 후보자에게 먼저 물어본다).
    await supabase
      .from("response_requests")
      .update({ kind: "candidate_wide_availability" })
      .eq("token", token);
    // 아직 최종 제출이 아니라 다음 단계로 넘어가는 것뿐이므로, 이 요청을 submitted로
    // 표시하는 아래 공통 로직을 타지 않고 바로 반환한다.
    return NextResponse.json({ ok: true });
  } else if (reqRow.kind === "candidate_wide_availability") {
    // 후보자가 다음 주 중 가능한 시간을 체크해서 보냈으면(candidateSlots), 그 시간
    // 전체를 면접관 전원에게 보내 참석 가능 여부를 확인받는다(reschedule과 동일).
    // 하나도 체크하지 않고 자유 입력(가능한 시점/사유)만 보냈으면, 매칭 엔진이 처리할
    // 수 없는 예외이므로 리크루터에게 그대로 에스컬레이션한다.
    const { data: interview } = await supabase
      .from("interviews")
      .select("*")
      .eq("id", reqRow.interview_id)
      .single();
    if (interview) {
      const origin = new URL(request.url).origin;
      const candidateSlots = [...new Set(availableSlots ?? [])].sort();

      if (candidateSlots.length) {
        await supabase
          .from("interviews")
          .update({ preferred_slots: candidateSlots, stage: "candidate_done" })
          .eq("id", interview.id);
        const { data: reFetched } = await supabase.from("interviews").select("*").eq("id", interview.id).single();
        if (reFetched) await requestPriorityConfirmation(supabase, reFetched, origin);
      } else {
        await supabase
          .from("interviews")
          .update({
            status: "escalated",
            stage: "interviewer_done",
            note: candidateNote?.trim()
              ? `후보자가 다음 주도 참석이 어렵다고 함 — 가능한 시점/사유: "${candidateNote.trim()}"`
              : "후보자가 다음 주도 참석이 어렵다고 함(사유 미기재) — 리크루터 확인 필요",
          })
          .eq("id", interview.id);
      }
    }
  } else if (reqRow.kind === "candidate") {
    // 후보자는 1~3순위를 제출할 뿐, 여기서 곧바로 매칭·확정하지 않는다. 제출 즉시
    // 면접관 전원에게 그 1~3개 시간 각각 참석 가능한지 확인 요청을 보내고, 전원이
    // 가능하다고 한 가장 높은 순위로 자동 확정한다(requestPriorityConfirmation).
    const finalSlots = preferredSlots ?? selectedSlots ?? [];
    await supabase
      .from("interviews")
      .update({ preferred_slots: finalSlots, stage: "candidate_done" })
      .eq("id", reqRow.interview_id);
    // 재조율이 일어나면 interviews.preferred_slots는 초기화되니, 이번에 실제로
    // 뭘 골랐는지는 이 요청 행 자체에도 스냅샷으로 남겨 히스토리에서 볼 수 있게 한다.
    await supabase
      .from("response_requests")
      .update({ answered_preferred_slots: finalSlots })
      .eq("token", token);

    const { data: interview } = await supabase
      .from("interviews")
      .select("*")
      .eq("id", reqRow.interview_id)
      .single();
    if (interview) {
      const origin = new URL(request.url).origin;
      await requestPriorityConfirmation(supabase, interview, origin);
    }
  } else if (reqRow.kind === "priority_confirm") {
    // 이 시간 중 참석 가능한 시간만 남기고, 나머지는 실제 캘린더(busy_slots)에도
    // 반영한다 — matchAndPersist는 busy_slots만 보고 검증하므로, 여기서 한 답변이
    // 곧 실제 가용 여부의 근거가 되게 하기 위함이다.
    const offered = (reqRow.confirm_slots as string[] | null) ?? [];
    const nowUnavailable = offered.filter((s) => !(availableSlots ?? []).includes(s));
    const { data: interviewer } = await supabase
      .from("interviewers")
      .select("busy_slots")
      .eq("id", reqRow.interviewer_id)
      .single();
    const keptBusy = ((interviewer?.busy_slots as string[] | null) ?? []).filter((s) => !offered.includes(s));
    // 지금 답한 내용을 그대로 기록해둔다 — busy_slots는 나중에 또 바뀔 수 있어서,
    // "이때 뭐라고 답했는지"를 리크루터가 나중에도 확인할 수 있게 하기 위함이다.
    await supabase.from("response_requests").update({ answered_slots: availableSlots ?? [] }).eq("token", token);
    await supabase
      .from("interviewers")
      .update({ busy_slots: [...keptBusy, ...nowUnavailable] })
      .eq("id", reqRow.interviewer_id);
  } else if (reqRow.kind === "reschedule_request") {
    // 확정된 일정을 후보자가 바꿔달라고 요청한 경우. 기존 매칭된 시간을 먼저 비우고,
    // 후보자가 이번에 넓게 체크해서 보낸 "가능한 시간들"을 받는다. 이미 알고 있는
    // 면접관 캘린더만 보고 조용히 확정하지 않는다 — 그 데이터가 마지막 응답 이후
    // 바뀌었을 수 있으니, 후보자가 가능하다고 한 시간 전체를 면접관 전원에게 다시
    // 확인받는다(priority_confirm 재사용). 전원이 응답하면 그중 전원 가능한 가장 앞
    // 시간으로 자동 확정된다.
    const { data: interview } = await supabase
      .from("interviews")
      .select("*")
      .eq("id", reqRow.interview_id)
      .single();

    if (interview && interview.status === "confirmed" && interview.matched_slot) {
      const oldSlot = interview.matched_slot as string;

      const { data: panel } = await supabase.from("interviewers").select("*").in("id", interview.panel);
      for (const p of panel ?? []) {
        if ((p.busy_slots as string[]).includes(oldSlot)) {
          await supabase
            .from("interviewers")
            .update({ busy_slots: (p.busy_slots as string[]).filter((s) => s !== oldSlot) })
            .eq("id", p.id);
        }
      }
      if (interview.room_id) {
        const { data: room } = await supabase.from("rooms").select("*").eq("id", interview.room_id).single();
        if (room && (room.busy_slots as string[]).includes(oldSlot)) {
          await supabase
            .from("rooms")
            .update({ busy_slots: (room.busy_slots as string[]).filter((s) => s !== oldSlot) })
            .eq("id", interview.room_id);
        }
      }

      // 방금 거절당한 이 시간은 앞으로도 다시 추천하지 않도록 영구히 제외 목록에 남긴다.
      const excludedSlots = [...new Set([...(interview.excluded_slots as string[]), oldSlot])];
      const candidateSlots = [...new Set(availableSlots ?? [])]
        .filter((s) => !excludedSlots.includes(s))
        .sort();

      await supabase
        .from("interviews")
        .update({
          status: "pending",
          matched_slot: null,
          room_id: null,
          confirmation_sent_at: null,
          preferred_slots: [],
          excluded_slots: excludedSlots,
          note: "후보자가 일정 변경을 요청함 — 재조율 중",
        })
        .eq("id", interview.id);

      const origin = new URL(request.url).origin;

      if (candidateSlots.length) {
        // 후보자가 가능하다고 체크한 시간 전체를 면접관 전원에게 보내 참석 가능 여부를
        // 확인받는다. 전원이 응답하면 confirmFromPriorities가 전원 가능한 가장 앞
        // 시간으로 자동 확정한다(면접관이 여러 명이어도 후보자가 넓게 체크했으니
        // 공통 시간을 찾을 여지가 충분하다).
        await supabase
          .from("interviews")
          .update({ preferred_slots: candidateSlots, stage: "candidate_done" })
          .eq("id", interview.id);
        const { data: reFetched } = await supabase.from("interviews").select("*").eq("id", interview.id).single();
        if (reFetched) await requestPriorityConfirmation(supabase, reFetched, origin);
      } else {
        // 후보자가 가능한 시간을 하나도 체크하지 않았으면, 폴백으로 면접관 전원에게
        // 처음부터 다시 가능 시간을 수합한다.
        await supabase
          .from("interviews")
          .update({
            availability_round: 1,
            status: "pending",
            note: "후보자가 가능한 시간을 선택하지 않음 — 면접관 전원에게 다시 가능 시간을 수합함",
          })
          .eq("id", interview.id);
        const { data: reFetched } = await supabase.from("interviews").select("*").eq("id", interview.id).single();
        if (reFetched) await sendInterviewerInvites(supabase, reFetched, origin);
      }
    }
  } else {
    await supabase
      .from("interviewers")
      .update({ busy_slots: selectedSlots ?? [] })
      .eq("id", reqRow.interviewer_id);
    // interviewers.busy_slots는 다음 라운드에 덮어써지니, 이번 라운드에 실제로
    // 제출한 값은 이 요청 행에 스냅샷으로 남겨 히스토리에서 볼 수 있게 한다.
    await supabase
      .from("response_requests")
      .update({ answered_busy_slots: selectedSlots ?? [] })
      .eq("token", token);
  }

  await supabase
    .from("response_requests")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("token", token);

  // 이 면접 케이스에 딸린 면접관 응답 요청이 전부 제출됐으면, 전원 동시 가능한 시간이
  // 실제로 있는지부터 확인한다. 없으면 후보자에게는 절대 안내하지 않고, 조회 기간을
  // 넓혀 면접관 전원에게 다시 문의한다(상한 넘으면 리크루터에게 에스컬레이션).
  if (reqRow.kind === "interviewer" && reqRow.interview_id) {
    const { data: allRequests } = await supabase
      .from("response_requests")
      .select("id, status")
      .eq("interview_id", reqRow.interview_id)
      .eq("kind", "interviewer");
    const allDone = allRequests?.every((r) => r.status === "submitted");

    // 이 기간엔 전부 불가능하다고 표시했으면, 이 기간 안에서는 이미 매칭이 불가능하다는
    // 게 확정이므로 다른 면접관 응답을 기다리지 않고 곧바로 재문의 단계로 넘어간다.
    // 아직 대기 중인 다른 요청은 이번 라운드에서는 더 의미가 없으니 함께 정리해둔다.
    if (!allDone && allUnavailable) {
      const stillPending = (allRequests ?? []).filter((r) => r.status === "pending").map((r) => r.id);
      if (stillPending.length) {
        await supabase
          .from("response_requests")
          .update({ status: "submitted", submitted_at: new Date().toISOString() })
          .in("id", stillPending);
      }
    }

    if (allDone || allUnavailable) {
      const { data: interview } = await supabase
        .from("interviews")
        .select("*")
        .eq("id", reqRow.interview_id)
        .single();

      // 면접관 링크를 재사용할 수 있게 되면서, 이미 후보자에게 안내가 나갔거나 후보자가
      // 순위를 제출한 뒤에도 면접관이 캘린더를 다시 고쳐 제출할 수 있다. 그 경우 busy_slots는
      // 갱신하되, 이미 지난 단계(candidate_pending/candidate_done 등)를 되돌리거나 후보자에게
      // 또 초대 메일을 보내지는 않는다 — 딱 면접관 응답을 다 모으는 단계에서만 다음으로 넘어간다.
      if (interview && interview.stage === "interviewer_pending") {
        const { data: panelInterviewers } = await supabase
          .from("interviewers")
          .select("*")
          .in("id", interview.panel);
        const needsRoom = requiresRoom(interview.interview_type);
        const { data: rooms } = needsRoom
          ? await supabase.from("rooms").select("*")
          : { data: [] };

        const businessDays = interview.availability_round * 5;
        const recommendations = recommendLeastConflictSlots(
          panelInterviewers ?? [],
          rooms ?? [],
          needsRoom,
          businessDays,
        );
        const hasPerfectMatch = recommendations.length > 0 && recommendations[0].conflicts.length === 0;

        const origin = new URL(request.url).origin;

        if (hasPerfectMatch) {
          await supabase.from("interviews").update({ stage: "interviewer_done" }).eq("id", interview.id);
          // 실패해도(이메일 없음 등) stage는 'interviewer_done'에 머물러 상세 화면에서 수동 재발송 가능
          await sendCandidateInvite(supabase, interview, origin);
        } else if (interview.availability_round < MAX_AVAILABILITY_ROUNDS) {
          await requestMoreAvailability(supabase, interview, origin, interview.availability_round + 1);
        } else {
          await supabase
            .from("interviews")
            .update({
              stage: "interviewer_done",
              status: "escalated",
              note: `면접관 전원 동시 가능 시간 없음 — 조회 기간을 ${MAX_AVAILABILITY_ROUNDS}차까지 넓혀도 찾지 못함, 리크루터 확인 필요`,
            })
            .eq("id", interview.id);
        }
      }
    }
  }

  // 우선순위 확인 요청에 면접관 전원이 응답을 마쳤으면, 전원 가능한 가장 높은
  // 순위로 자동 확정한다. 이미 확정·에스컬레이션된 뒤(늦게 다시 고쳐 제출한 경우)라면
  // 다시 실행하지 않는다.
  if (reqRow.kind === "priority_confirm" && reqRow.interview_id) {
    const { data: allConfirmRequests } = await supabase
      .from("response_requests")
      .select("status")
      .eq("interview_id", reqRow.interview_id)
      .eq("kind", "priority_confirm");
    const allDone = allConfirmRequests?.every((r) => r.status === "submitted");

    if (allDone) {
      const { data: interview } = await supabase
        .from("interviews")
        .select("*")
        .eq("id", reqRow.interview_id)
        .single();
      if (interview && interview.status === "pending") {
        await confirmFromPriorities(supabase, interview);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
