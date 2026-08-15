import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateToken } from "@/lib/token";
import { sendEmail, emailErrorReason } from "@/lib/email";
import { formatSlotLabel } from "@/lib/slots";

type Params = { params: Promise<{ id: string }> };

const RANK_MEDAL = ["🥇", "🥈", "🥉"];

/**
 * "최종 참석 확인"(priority_confirm) 메일이 실패했거나 그냥 응답이 없을 때, 이
 * 면접관 한 명에게만 같은 후보자 순위(confirm_slots)로 새 링크를 만들어 재발송한다.
 * reinvite-interviewer(면접관 초대용)와 같은 이유로 별도 라우트가 필요하다 —
 * kind가 다르면 응답 처리 로직도 달라서 하나로 합치지 않았다.
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
  const preferredSlots = (interview.preferred_slots as string[]) ?? [];
  if (!preferredSlots.length) {
    return NextResponse.json({ error: "후보자가 제출한 순위가 없습니다." }, { status: 400 });
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
    kind: "priority_confirm",
    interview_id: id,
    interviewer_id: interviewerId,
    confirm_slots: preferredSlots,
  });

  const origin = new URL(request.url).origin;
  const link = `${origin}/respond/${token}`;
  const list = preferredSlots.map((s, i) => `${RANK_MEDAL[i] ?? `${i + 1}순위`} ${formatSlotLabel(s)}`).join("<br/>");

  try {
    await sendEmail(
      interviewer.email,
      `[인터뷰싱크] ${interview.candidate_name}(${interview.position}) 최종 면접 시간 확인 요청`,
      `
        <p>안녕하세요, ${interviewer.name}님.</p>
        <p><b>${interview.candidate_name}</b>님(${interview.position})이 아래 순서로 면접 시간을 제안했습니다.</p>
        <p>${list}</p>
        <p>참석 가능한 시간을 모두 확인해주세요.</p>
        <p><a href="${link}">${link}</a></p>
      `,
    );
  } catch (e) {
    const reason = emailErrorReason(e);
    await supabase
      .from("interviews")
      .update({ note: `⚠️ ${interviewer.name}님에게 최종 확인 재발송 실패(사유: ${reason}) — 다시 시도해주세요` })
      .eq("id", id);
    return NextResponse.json({ error: `메일 발송에 실패했습니다(${reason}).` }, { status: 502 });
  }

  await supabase.from("response_requests").update({ email_sent_at: new Date().toISOString() }).eq("token", token);

  if (interview.note?.includes("최종 확인 요청 메일 발송 실패") || interview.note?.includes("최종 확인 재발송 실패")) {
    await supabase.from("interviews").update({ note: null }).eq("id", id);
  }

  return NextResponse.json({ ok: true });
}
