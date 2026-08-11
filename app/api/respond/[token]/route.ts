import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchAndPersist } from "@/lib/applyMatch";
import { generateUpcomingSlots, formatSlotLabel } from "@/lib/slots";
import { sendCandidateInvite } from "@/lib/sendCandidateInvite";
import { recommendLeastConflictSlots, requiresRoom } from "@/lib/matching";
import { requestMoreAvailability, MAX_AVAILABILITY_ROUNDS } from "@/lib/requestMoreAvailability";

type Params = { params: Promise<{ token: string }> };

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
      .select("candidate_name, position, recommended_slots")
      .eq("id", reqRow.interview_id)
      .single();

    // 발송 시점에 고정해둔 추천 시간들만 보여준다 — 재조회 시점의 면접관 가용
    // 시간으로 다시 계산하면 이메일로 안내한 시간과 달라질 수 있기 때문이다.
    const slots = ((interview?.recommended_slots as string[] | null) ?? []).map((key) => ({
      key,
      label: formatSlotLabel(key),
    }));

    return NextResponse.json({
      kind: "candidate",
      status: reqRow.status,
      name: interview?.candidate_name,
      subtitle: interview?.position,
      slots,
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
  const { selectedSlots, allUnavailable } = (await request.json()) as {
    selectedSlots?: string[];
    allUnavailable?: boolean;
  };

  const supabase = createAdminClient();
  const { data: reqRow, error } = await supabase
    .from("response_requests")
    .select("*")
    .eq("token", token)
    .single();
  if (error) return NextResponse.json({ error: "유효하지 않은 링크입니다." }, { status: 404 });
  if (reqRow.status === "submitted") {
    return NextResponse.json({ error: "이미 제출된 응답입니다." }, { status: 400 });
  }

  if (reqRow.kind === "candidate" && allUnavailable) {
    // 제안된 시간이 전부 안 맞는다는 응답 — 매칭을 시도하지 않고, 조회 기간을 넓혀
    // 면접관 전원에게 다시 문의한다(면접관 쪽 재문의 로직을 그대로 재사용).
    const { data: interview } = await supabase
      .from("interviews")
      .select("*")
      .eq("id", reqRow.interview_id)
      .single();
    if (interview) {
      const origin = new URL(request.url).origin;
      if (interview.availability_round < MAX_AVAILABILITY_ROUNDS) {
        await requestMoreAvailability(supabase, interview, origin, interview.availability_round + 1);
      } else {
        await supabase
          .from("interviews")
          .update({
            status: "escalated",
            stage: "interviewer_done",
            note: `후보자가 제안된 시간을 모두 거절함 — 조회 기간을 ${MAX_AVAILABILITY_ROUNDS}차까지 넓혀도 대안을 찾지 못함, 리크루터 확인 필요`,
          })
          .eq("id", interview.id);
      }
    }
  } else if (reqRow.kind === "candidate") {
    const { data: interview } = await supabase
      .from("interviews")
      .select("panel, interview_type")
      .eq("id", reqRow.interview_id)
      .single();
    await matchAndPersist(
      supabase,
      reqRow.interview_id,
      selectedSlots ?? [],
      interview!.panel,
      interview!.interview_type,
    );
    await supabase.from("interviews").update({ stage: "candidate_done" }).eq("id", reqRow.interview_id);
  } else {
    await supabase
      .from("interviewers")
      .update({ busy_slots: selectedSlots ?? [] })
      .eq("id", reqRow.interviewer_id);
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
      .select("status")
      .eq("interview_id", reqRow.interview_id)
      .eq("kind", "interviewer");
    const allDone = allRequests?.every((r) => r.status === "submitted");
    if (allDone) {
      const { data: interview } = await supabase
        .from("interviews")
        .select("*")
        .eq("id", reqRow.interview_id)
        .single();

      if (interview) {
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

  return NextResponse.json({ ok: true });
}
