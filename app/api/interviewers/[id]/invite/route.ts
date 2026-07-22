import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { generateToken } from "@/lib/token";
import { sendEmail } from "@/lib/email";
import { generateUpcomingSlots } from "@/lib/slots";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: interviewer, error } = await supabase
    .from("interviewers")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  if (!interviewer.email) {
    return NextResponse.json({ error: "면접관 이메일이 등록되어 있지 않습니다." }, { status: 400 });
  }

  const token = generateToken();
  const { error: insErr } = await supabase.from("response_requests").insert({
    token,
    kind: "interviewer",
    interviewer_id: id,
  });
  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

  const origin = new URL(request.url).origin;
  const link = `${origin}/respond/${token}`;

  await sendEmail(
    interviewer.email,
    `[인터뷰싱크] 면접 불가능한 시간을 알려주세요`,
    `
      <p>안녕하세요, ${interviewer.name}님.</p>
      <p>아래 시간대 중 면접이 <b>불가능한</b> 시간을 모두 선택해주세요.</p>
      <p><a href="${link}">${link}</a></p>
      <p style="color:#888;font-size:12px">전체 시간대: ${generateUpcomingSlots().map((s) => s.label).join(", ")}</p>
    `,
  );

  return NextResponse.json({ ok: true });
}
