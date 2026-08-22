import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runConsistencyCheck } from "@/lib/checkConsistency";

export const maxDuration = 30;
export const dynamic = "force-dynamic";

/**
 * 매일 1회 Vercel Cron이 호출하는 데이터 정합성 검사 엔트리포인트 (vercel.json 참고).
 *
 * matching.test.ts는 가짜 시나리오로 매칭 로직 자체를 확인하지만, 실제로 확정된
 * 데이터에 모순(이중 배정 등)이 생겼는지는 확인하지 못한다 — 이 크론이 그 부분을
 * 매일 한 번 실제 데이터로 확인한다.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const violations = await runConsistencyCheck(supabase);

  return NextResponse.json({
    ranAt: new Date().toISOString(),
    violationCount: violations.length,
    violations,
  });
}
