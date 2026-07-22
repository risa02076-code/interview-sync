import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendCandidateInvite } from "@/lib/sendCandidateInvite";

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

  if (interview.stage !== "interviewer_done") {
    return NextResponse.json(
      { error: "먼저 면접관 전원의 가능 시간 응답을 받아야 후보자에게 발송할 수 있습니다." },
      { status: 400 },
    );
  }

  const origin = new URL(request.url).origin;
  const result = await sendCandidateInvite(supabase, interview, origin);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json(result);
}
