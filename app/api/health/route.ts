import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 외부 업타임 모니터링(UptimeRobot 등)이 주기적으로 호출하는 엔드포인트.
 * 단순히 "페이지가 열리는지"가 아니라 실제로 DB에 접근 가능한지까지 확인해야,
 * Vercel은 떠 있는데 Supabase 연결만 끊긴 경우도 감지할 수 있다.
 */
export async function GET() {
  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from("interviews").select("id").limit(1);
    if (error) throw error;
    return NextResponse.json({ ok: true, db: "connected", checkedAt: new Date().toISOString() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 503 },
    );
  }
}
