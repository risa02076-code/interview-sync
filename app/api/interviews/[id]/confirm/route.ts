import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendConfirmationEmail } from "@/lib/sendConfirmationEmail";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: interview, error } = await supabase
    .from("interviews")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  // 정합성 오류로 보류됐을 때, 문제없다고 판단하면 body에 { "force": true }를
  // 담아 다시 요청해서 확인을 건너뛰고 발송할 수 있다.
  const body = await request.json().catch(() => ({}));
  const force = body?.force === true;

  const origin = new URL(request.url).origin;
  const result = await sendConfirmationEmail(supabase, interview, origin, { force });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json(result);
}
