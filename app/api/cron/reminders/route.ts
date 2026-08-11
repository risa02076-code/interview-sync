import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendPendingResponseReminders, sendDayBeforeReminders } from "@/lib/sendReminders";

// 메일 발송이 여러 건 이어질 수 있어 기본 실행 시간으로는 부족하다
export const maxDuration = 60;
export const dynamic = "force-dynamic";

/**
 * 매일 1회 Vercel Cron이 호출하는 리마인더 엔트리포인트 (vercel.json 참고).
 *
 * 1) 응답이 없는 면접관·후보자에게 독촉 메일 발송
 * 2) 내일 면접인 확정 케이스에 전날 알림 발송
 *
 * 매 실행마다 Supabase를 조회하므로, 무료 플랜 프로젝트가 미사용으로 일시정지되는 것도
 * 함께 막아준다(7일 무요청 시 자동 정지).
 */
export async function GET(request: Request) {
  // Vercel Cron은 CRON_SECRET 값을 Authorization 헤더에 담아 호출한다.
  // 시크릿이 설정돼 있으면 반드시 일치해야 실행한다 (공개 URL 무단 호출 차단).
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const origin = new URL(request.url).origin;

  const pendingNudges = await sendPendingResponseReminders(supabase, origin);
  const dayBeforeReminders = await sendDayBeforeReminders(supabase);

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    pendingNudges,
    dayBeforeReminders,
  });
}
