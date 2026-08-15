import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateToken } from "@/lib/token";
import { sendEmail, emailErrorReason } from "@/lib/email";

type Params = { params: Promise<{ id: string }> };

/**
 * 면접관 관리 페이지의 "문의 메일 보내기"는 이 interview_id와 연결되지 않은 별도
 * 링크를 새로 만들어서, 실패한 특정 케이스를 재시도하는 용도로 쓰면 그 케이스의
 * 진행 상황에 반영되지 않는 문제가 있었다. 이 라우트는 반드시 이 interview_id에
 * 연결된 새 토큰으로 그 면접관 한 명에게만 다시 보낸다.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const { interviewerId } = (await request.json()) as { interviewerId?: string };
  if (!interviewerId) return NextResponse.json({ error: "면접관을 선택해주세요." }, { status: 400 });

  const supabase = createAdminClient();
  const { data: interview, error } = await supabase.from("interviews").select("*").eq("id", id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  if (!(interview.panel as string[]).includes(interviewerId)) {
    return NextResponse.json({ error: "이 면접의 패널이 아닙니다." }, { status: 400 });
  }

  const { data: interviewer, error: ivErr } = await supabase
    .from("interviewers")
    .select("name, email")
    .eq("id", interviewerId)
    .single();
  if (ivErr) return NextResponse.json({ error: ivErr.message }, { status: 404 });
  if (!interviewer.email) {
    return NextResponse.json({ error: "이 면접관의 이메일이 등록되어 있지 않습니다." }, { status: 400 });
  }

  const token = generateToken();
  await supabase.from("response_requests").insert({
    token,
    kind: "interviewer",
    interview_id: id,
    interviewer_id: interviewerId,
  });

  const origin = new URL(request.url).origin;
  const link = `${origin}/respond/${token}`;

  try {
    await sendEmail(
      interviewer.email,
      `[인터뷰싱크] ${interview.candidate_name}(${interview.position}) 면접 - 불가능한 시간을 알려주세요`,
      `
        <p>안녕하세요, ${interviewer.name}님.</p>
        <p><b>${interview.candidate_name}</b>님(${interview.position}) 면접 관련해서 연락드립니다.</p>
        <p>아래 링크의 30분 단위 캘린더에서 <b>불가능한</b> 시간을 모두 선택해주세요.</p>
        <p><a href="${link}">${link}</a></p>
      `,
    );
  } catch (e) {
    const reason = emailErrorReason(e);
    await supabase
      .from("interviews")
      .update({ note: `⚠️ ${interviewer.name}님에게 재발송 실패(사유: ${reason}) — 다시 시도해주세요` })
      .eq("id", id);
    return NextResponse.json({ error: `메일 발송에 실패했습니다(${reason}).` }, { status: 502 });
  }

  await supabase.from("response_requests").update({ email_sent_at: new Date().toISOString() }).eq("token", token);

  // 재발송이 성공했으면, 이전에 이 사람 때문에 남아있던 "초대 실패" note는 정리한다.
  if (interview.note?.includes("면접관 초대 메일 발송 실패") || interview.note?.includes("재발송 실패")) {
    await supabase.from("interviews").update({ note: null }).eq("id", id);
  }

  return NextResponse.json({ ok: true });
}
