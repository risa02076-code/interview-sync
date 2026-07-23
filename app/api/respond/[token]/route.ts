import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchAndPersist } from "@/lib/applyMatch";
import { generateUpcomingSlots } from "@/lib/slots";
import { sendCandidateInvite } from "@/lib/sendCandidateInvite";
import { requiresRoom } from "@/lib/matching";

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
      .select("candidate_name, position, panel, interview_type")
      .eq("id", reqRow.interview_id)
      .single();

    const { data: panelInterviewers } = await supabase
      .from("interviewers")
      .select("busy_slots")
      .in("id", interview?.panel ?? []);
    const needsRoom = requiresRoom(interview?.interview_type ?? "1차 대면");
    const { data: rooms } = needsRoom
      ? await supabase.from("rooms").select("busy_slots")
      : { data: null };

    const slots = generateUpcomingSlots().filter((s) => {
      const panelBusy = panelInterviewers?.some((p) => p.busy_slots.includes(s.key));
      if (panelBusy) return false;
      if (needsRoom && !rooms?.some((r) => !r.busy_slots.includes(s.key))) return false;
      return true;
    });

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
    .select("name, role")
    .eq("id", reqRow.interviewer_id)
    .single();
  return NextResponse.json({
    kind: "interviewer",
    status: reqRow.status,
    name: interviewer?.name,
    subtitle: interviewer?.role,
    slots: generateUpcomingSlots(),
  });
}

export async function POST(request: Request, { params }: Params) {
  const { token } = await params;
  const { selectedSlots } = (await request.json()) as { selectedSlots: string[] };

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

  if (reqRow.kind === "candidate") {
    const { data: interview } = await supabase
      .from("interviews")
      .select("panel, interview_type")
      .eq("id", reqRow.interview_id)
      .single();
    await matchAndPersist(
      supabase,
      reqRow.interview_id,
      selectedSlots,
      interview!.panel,
      interview!.interview_type,
    );
    await supabase.from("interviews").update({ stage: "candidate_done" }).eq("id", reqRow.interview_id);
  } else {
    await supabase
      .from("interviewers")
      .update({ busy_slots: selectedSlots })
      .eq("id", reqRow.interviewer_id);
  }

  await supabase
    .from("response_requests")
    .update({ status: "submitted", submitted_at: new Date().toISOString() })
    .eq("token", token);

  // 이 면접 케이스에 딸린 면접관 응답 요청이 전부 제출됐으면, 곧바로 후보자에게
  // 희망시간 문의 메일을 자동 발송한다 (면접관 → 후보자 순서 자동화).
  if (reqRow.kind === "interviewer" && reqRow.interview_id) {
    const { data: allRequests } = await supabase
      .from("response_requests")
      .select("status")
      .eq("interview_id", reqRow.interview_id)
      .eq("kind", "interviewer");
    const allDone = allRequests?.every((r) => r.status === "submitted");
    if (allDone) {
      await supabase
        .from("interviews")
        .update({ stage: "interviewer_done" })
        .eq("id", reqRow.interview_id);

      const { data: interview } = await supabase
        .from("interviews")
        .select("*")
        .eq("id", reqRow.interview_id)
        .single();
      if (interview) {
        const origin = new URL(request.url).origin;
        // 실패해도(이메일 없음 등) stage는 'interviewer_done'에 머물러 상세 화면에서 수동 재발송 가능
        await sendCandidateInvite(supabase, interview, origin);
      }
    }
  }

  return NextResponse.json({ ok: true });
}
