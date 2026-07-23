import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendInterviewerInvites } from "@/lib/sendInterviewerInvites";

export async function GET() {
  const supabase = createAdminClient();

  const { data: interviews, error } = await supabase
    .from("interviews")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: interviewers } = await supabase.from("interviewers").select("id,name,role");
  const { data: rooms } = await supabase.from("rooms").select("id,name");
  const { data: requests } = await supabase
    .from("response_requests")
    .select("interview_id,interviewer_id,kind,status");

  const enriched = interviews.map((iv) => {
    const interviewerReqs =
      requests?.filter((r) => r.interview_id === iv.id && r.kind === "interviewer") ?? [];
    const candidateReq = requests?.find(
      (r) => r.interview_id === iv.id && r.kind === "candidate",
    );

    const panelDetail = (iv.panel as string[])
      .map((id) => interviewers?.find((p) => p.id === id))
      .filter(Boolean)
      .map((p) => ({
        ...p!,
        responded: interviewerReqs.some((r) => r.interviewer_id === p!.id && r.status === "submitted"),
      }));

    return {
      ...iv,
      panelDetail,
      roomName: rooms?.find((r) => r.id === iv.room_id)?.name ?? null,
      interviewerProgress: {
        submitted: interviewerReqs.filter((r) => r.status === "submitted").length,
        total: interviewerReqs.length,
      },
      candidateResponded: candidateReq?.status === "submitted",
    };
  });

  return NextResponse.json(enriched);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { candidateName, candidateEmail, position, panel, interviewType } = body as {
    candidateName: string;
    candidateEmail: string;
    position: string;
    panel: string[];
    interviewType?: string;
  };

  if (!candidateName?.trim() || !position?.trim() || !candidateEmail?.trim() || !panel?.length) {
    return NextResponse.json(
      { error: "후보자 이름, 이메일, 직무, 면접 패널은 필수입니다." },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  const { data: created, error: cErr } = await supabase
    .from("interviews")
    .insert({
      candidate_name: candidateName,
      candidate_email: candidateEmail,
      position,
      panel,
      interview_type: interviewType || "1차 대면",
      preferred_slots: [],
      status: "pending",
      stage: "created",
    })
    .select()
    .single();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  // 등록과 동시에 면접관에게 가능 시간 문의 메일을 자동 발송한다.
  // (면접관 이메일이 없는 등 실패하면 stage는 'created'로 남아 상세 화면에서 수동 재발송 가능)
  const origin = new URL(request.url).origin;
  const inviteResult = await sendInterviewerInvites(supabase, created, origin);

  return NextResponse.json({ ...created, inviteResult }, { status: 201 });
}
