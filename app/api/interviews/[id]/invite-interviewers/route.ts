import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendInterviewerInvites } from "@/lib/sendInterviewerInvites";

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

  const origin = new URL(request.url).origin;
  const result = await sendInterviewerInvites(supabase, interview, origin);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json(result);
}
