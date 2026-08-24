import { ConnectSupabaseSteps } from "@/components/tutorial/connect-supabase-steps";
import { hasEnvVars } from "@/lib/utils";
import Link from "next/link";

export default function Home() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center">
      <div className="flex flex-col gap-6 px-4 items-center text-center max-w-xl">
        <h2 className="font-medium text-2xl">인터뷰싱크 — 면접 일정 자동 매칭</h2>
        <p className="text-muted-foreground">
          후보자 희망시간과 면접관·면접실 캘린더를 자동으로 대조해 면접 일정을 확정하고,
          변경이 생기면 자동으로 재조율합니다.
        </p>
        <Link
          href="/interviews"
          className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
        >
          조율 대시보드 열기 →
        </Link>
        {!hasEnvVars && (
          <div className="w-full">
            <ConnectSupabaseSteps />
          </div>
        )}
      </div>
    </main>
  );
}
