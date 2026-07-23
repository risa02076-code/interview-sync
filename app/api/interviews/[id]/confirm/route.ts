import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendConfirmationEmail } from "@/lib/sendConfirmationEmail";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: interview, error } = await supabase
    .from("interviews")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const result = await sendConfirmationEmail(supabase, interview);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });

  return NextResponse.json(result);
}
