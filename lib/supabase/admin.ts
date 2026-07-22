import { createClient } from "@supabase/supabase-js";

/**
 * API 라우트(서버) 전용 클라이언트. 서비스 롤 키를 사용해 RLS를 우회한다.
 * 브라우저에는 절대 노출되지 않음 — 프론트엔드는 항상 /api/* 를 통해서만 접근한다.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );
}
