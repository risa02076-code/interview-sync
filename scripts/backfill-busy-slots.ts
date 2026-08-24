/**
 * 소요시간(INTERVIEW_DURATION_MINUTES) 도입 이전에 확정된 면접들의 busy_slots를
 * 소급해서 채운다.
 *
 * 왜 필요한가: 예전에는 확정할 때 시작 슬롯 하나만 "사용 중"으로 표시했다.
 * 10:00에 확정된 1시간 면접의 10:30이 여전히 비어 있는 것으로 보이므로, 같은
 * 면접관·회의실에 10:30 면접이 또 잡힐 수 있다. 새로 확정되는 건은 applyMatch가
 * 구간 전체를 점유하지만 옛 건들은 그대로 남아 있다.
 *
 * 무엇을 하는가: 확정(confirmed/rescheduled)된 면접이 실제로 걸치는 슬롯 전체와
 * 지금 저장된 busy_slots를 대조해서, **빠진 슬롯만 더한다**. 지우는 일은 절대
 * 하지 않는다(lib/backfillBusySlots.ts의 주석 참고).
 *
 * 실행:
 *   npm run backfill:busy-slots           # 미리보기만 — DB를 건드리지 않는다
 *   npm run backfill:busy-slots -- --apply  # 실제로 반영
 *
 * 로컬 dev 서버는 필요 없다(Supabase에 직접 붙는다). .env.local의
 * SUPABASE_SERVICE_ROLE_KEY를 쓰므로 어느 DB를 가리키는지 실행 전에 확인할 것.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { planBusySlotsBackfill, type BackfillInterview } from "../lib/backfillBusySlots";
import type { Interviewer, Room } from "../lib/matching";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.join(scriptDir, "..", ".env.local");

function readEnv(key: string): string {
  const fromProcess = process.env[key];
  if (fromProcess) return fromProcess;
  const file = fs.readFileSync(envPath, "utf8");
  const match = file.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) throw new Error(`${key}를 process.env에서도 .env.local에서도 찾지 못했다`);
  return match[1].trim();
}

const apply = process.argv.includes("--apply");

const supabase = createClient(
  readEnv("NEXT_PUBLIC_SUPABASE_URL"),
  readEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

async function main() {
  const [interviewsRes, interviewersRes, roomsRes] = await Promise.all([
    supabase.from("interviews").select("id,candidate_name,interview_type,panel,matched_slot,room_id,status"),
    supabase.from("interviewers").select("id,name,role,busy_slots"),
    supabase.from("rooms").select("id,name,busy_slots"),
  ]);
  for (const res of [interviewsRes, interviewersRes, roomsRes]) {
    if (res.error) throw res.error;
  }

  const plan = planBusySlotsBackfill(
    (interviewsRes.data ?? []) as BackfillInterview[],
    (interviewersRes.data ?? []) as Interviewer[],
    (roomsRes.data ?? []) as Room[],
  );

  console.log(
    `대상 조회 완료 — 면접 ${interviewsRes.data?.length ?? 0}건, 면접관 ${
      interviewersRes.data?.length ?? 0
    }명, 회의실 ${roomsRes.data?.length ?? 0}개`,
  );

  if (plan.skipped.length) {
    console.log(`\n[건너뜀] 참조하는 행이 DB에 없어 손댈 수 없는 ${plan.skipped.length}건:`);
    for (const s of plan.skipped) {
      console.log(`  - ${s.candidateName}(${s.interviewId}): ${s.reason}`);
    }
  }

  if (!plan.fixes.length) {
    console.log("\n채울 슬롯이 없다 — 모든 확정 건이 이미 구간 전체를 점유하고 있다.");
    return;
  }

  const totalSlots = plan.fixes.reduce((sum, f) => sum + f.missingSlots.length, 0);
  console.log(`\n${plan.fixes.length}개 행에 ${totalSlots}개 슬롯을 추가해야 한다:`);
  for (const fix of plan.fixes) {
    const label = fix.table === "interviewers" ? "면접관" : "회의실";
    console.log(`\n  ${label} ${fix.name} (${fix.id})`);
    console.log(`    지금: ${fix.currentSlots.length}칸 → 이후: ${fix.nextSlots.length}칸`);
    console.log(`    추가: ${fix.missingSlots.join(", ")}`);
    for (const reason of fix.reasons) console.log(`    사유: ${reason}`);
  }

  if (!apply) {
    console.log("\n미리보기만 했다. 실제로 반영하려면 --apply를 붙여 다시 실행할 것.");
    return;
  }

  console.log("\n--apply — 실제로 반영한다.");
  for (const fix of plan.fixes) {
    const { error } = await supabase
      .from(fix.table)
      .update({ busy_slots: fix.nextSlots })
      .eq("id", fix.id);
    if (error) {
      // 한 행이 실패해도 나머지는 계속 시도한다. 더하기만 하는 작업이라
      // 부분 적용돼도 데이터가 깨지지 않고, 다시 실행하면 남은 것만 채운다.
      console.error(`  실패: ${fix.table} ${fix.name} — ${error.message}`);
      continue;
    }
    console.log(`  완료: ${fix.table} ${fix.name} (+${fix.missingSlots.length})`);
  }
  console.log("\n같은 명령을 --apply 없이 다시 실행하면 남은 것이 없는지 확인할 수 있다.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
