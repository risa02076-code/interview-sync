import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchAndPersist } from "@/lib/applyMatch";
import { sendConfirmationEmail } from "@/lib/sendConfirmationEmail";

type Params = { params: Promise<{ id: string }> };

/**
 * 후보자가 제출한 1~3순위 시간 중, 리크루터가 고른 하나를 최종 확정한다.
 * 후보자가 제출한 시점과 리크루터가 확정하는 시점 사이에 면접관 일정이 바뀔 수
 * 있으므로, matchAndPersist로 그 시간이 지금도 실제로 비어있는지 다시 검증한다.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const { slot } = (await request.json()) as { slot: string };
  if (!slot) return NextResponse.json({ error: "시간을 선택해주세요." }, { status: 400 });

  const supabase = createAdminClient();
  const { data: interview, error } = await supabase
    .from("interviews")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  if (!(interview.preferred_slots as string[]).includes(slot)) {
    return NextResponse.json({ error: "후보자가 제출한 순위에 없는 시간입니다." }, { status: 400 });
  }

  const updated = await matchAndPersist(supabase, id, [slot], interview.panel, interview.interview_type);

  if (updated?.status !== "confirmed") {
    return NextResponse.json(
      { error: "그 사이 면접관 일정이 바뀌어 이 시간은 더 이상 가능하지 않습니다. 다른 순위를 선택해주세요." },
      { status: 409 },
    );
  }

  await sendConfirmationEmail(supabase, updated, new URL(request.url).origin);

  return NextResponse.json(updated);
}
