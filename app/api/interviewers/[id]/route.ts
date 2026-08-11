import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const { email, busy_slots } = (await request.json()) as {
    email?: string;
    busy_slots?: string[];
  };

  const patch: Record<string, unknown> = {};
  if (email !== undefined) patch.email = email;
  if (busy_slots !== undefined) patch.busy_slots = busy_slots;

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("interviewers")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}
