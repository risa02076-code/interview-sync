import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { matchAndPersist } from "@/lib/applyMatch";
import { sendConfirmationEmail } from "@/lib/sendConfirmationEmail";
import { ConfirmConflictError } from "@/lib/confirmInterview";
import { emailErrorReason } from "@/lib/email";

type Params = { params: Promise<{ id: string }> };

/**
 * 후보자가 제출한 1~3순위 시간 중, 리크루터가 고른 하나를 최종 확정한다.
 * 후보자가 제출한 시점과 리크루터가 확정하는 시점 사이에 면접관 일정이 바뀔 수
 * 있으므로, matchAndPersist로 그 시간이 지금도 실제로 비어있는지 다시 검증한다.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const { slot, force } = (await request.json()) as { slot: string; force?: boolean };
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

  let updated;
  try {
    updated = await matchAndPersist(supabase, id, [slot], interview.panel, interview.interview_type);
  } catch (e) {
    if (e instanceof ConfirmConflictError) {
      return NextResponse.json(
        { error: "그 사이 면접관 일정이 바뀌어 이 시간은 더 이상 가능하지 않습니다. 다른 순위를 선택해주세요." },
        { status: 409 },
      );
    }
    // 저장 자체가 실패한 경우(마이그레이션 누락 등) — 원인을 화면에 그대로 보여줘야
    // 리크루터가 뭘 해야 할지 판단할 수 있다. 조용히 삼키면 버튼을 몇 번이고 눌러보게
    // 만든다.
    console.error(`[confirm-failed] interview=${id}, slot=${slot}, error=${emailErrorReason(e)}`);
    return NextResponse.json(
      { error: `확정 저장에 실패했습니다(사유: ${emailErrorReason(e)})` },
      { status: 500 },
    );
  }

  if (updated?.status !== "confirmed") {
    return NextResponse.json(
      { error: "그 사이 면접관 일정이 바뀌어 이 시간은 더 이상 가능하지 않습니다. 다른 순위를 선택해주세요." },
      { status: 409 },
    );
  }

  // 확정 자체는 이미 성공했으므로 200으로 응답하되, 메일 발송 결과를 함께 실어
  // 보낸다. 결과를 버리면 정합성 오류로 발송이 보류돼도 화면에는 "발송했습니다"로
  // 보여서, 아무도 메일이 안 나간 걸 모른 채 넘어간다.
  const mail = await sendConfirmationEmail(supabase, updated, new URL(request.url).origin, {
    force: force === true,
  });

  return NextResponse.json({
    ...updated,
    mail: mail.ok ? { ok: true } : { ok: false, error: mail.error, held: mail.held ?? false },
  });
}
