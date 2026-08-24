/**
 * confirm_interview(supabase/migration_confirm_transaction.sql)가 실제로 약속대로
 * 동작하는지 진짜 DB에 대고 확인한다.
 *
 * 왜 필요한가: 이 함수는 plpgsql이라 tsc도 vitest도 닿지 않는다. 단위 테스트
 * (lib/confirmInterview.test.ts, lib/applyMatch.test.ts)는 "앱이 rpc를 올바른
 * 인자로 한 번만 부르는지"까지만 검증할 수 있고, "그 rpc가 정말 전부 되거나 전부
 * 안 되는지"는 검증하지 못한다. 그 마지막 한 칸을 여기서 메운다.
 *
 * 실행 전 필요조건
 *   - supabase/migration_confirm_transaction.sql을 Supabase SQL Editor에서 먼저 실행
 *   - .env.local에 실제 Supabase 키
 *   (로컬 dev 서버는 필요 없다 — Supabase에 직접 붙는다)
 *
 * 실행: npm run verify:confirm-transaction
 *
 * 주의: 실제 후보자 데이터가 있는 환경에서는 실행하지 말 것. 면접관·회의실의
 * busy_slots를 잠시 비웠다가 되돌리고, 테스트용 면접 케이스를 만들었다 지운다.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));

function readEnv(key: string): string {
  const fromProcess = process.env[key];
  if (fromProcess) return fromProcess;
  const file = fs.readFileSync(path.join(scriptDir, "..", ".env.local"), "utf8");
  const match = file.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match) throw new Error(`${key}를 찾지 못했다`);
  return match[1].trim();
}

const supabase = createClient(
  readEnv("NEXT_PUBLIC_SUPABASE_URL"),
  readEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

// 실제 데이터와 겹치지 않도록 먼 미래 시간을 쓴다(2030년 1월 2일 10:00~11:00 KST).
const SLOT = "2030-01-02T01:00:00.000Z";
const SPAN = [SLOT, "2030-01-02T01:30:00.000Z"];
const TEST_NAME_PREFIX = "__트랜잭션검증__";

let passed = 0;
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error("FAIL: " + msg);
  passed += 1;
  console.log("  OK:", msg);
}

type ConfirmResult = { ok: boolean; code: string | null; message: string | null };

async function callConfirm(
  interviewId: string,
  roomId: string | null,
  opts: { force?: boolean; abort?: boolean } = {},
): Promise<ConfirmResult> {
  const { error } = await supabase.rpc("confirm_interview", {
    p_interview_id: interviewId,
    p_slot: SLOT,
    p_span: SPAN,
    p_room_id: roomId,
    p_status: "confirmed",
    p_note: "트랜잭션 검증",
    p_stage: "candidate_done",
    p_preferred_slots: null,
    p_reset_confirmation: false,
    p_force: opts.force ?? false,
    p_abort_for_test: opts.abort ?? false,
  });
  return error
    ? { ok: false, code: error.code ?? null, message: error.message ?? null }
    : { ok: true, code: null, message: null };
}

async function busyOf(table: "interviewers" | "rooms", id: string): Promise<string[]> {
  const { data } = await supabase.from(table).select("busy_slots").eq("id", id).single();
  return ((data?.busy_slots as string[] | null) ?? []) as string[];
}

async function interviewRow(id: string) {
  const { data } = await supabase
    .from("interviews")
    .select("matched_slot,status,room_id,stage")
    .eq("id", id)
    .single();
  return data;
}

async function createInterview(suffix: string, panel: string[]) {
  const { data, error } = await supabase
    .from("interviews")
    .insert({
      candidate_name: TEST_NAME_PREFIX + suffix,
      position: "검증",
      interview_type: "1차 대면",
      panel,
      status: "pending",
      stage: "created",
    })
    .select()
    .single();
  if (error) throw error;
  return data.id as string;
}

async function setBusy(table: "interviewers" | "rooms", id: string, slots: string[]) {
  const { error } = await supabase.from(table).update({ busy_slots: slots }).eq("id", id);
  if (error) throw error;
}

async function main() {
  const { data: people } = await supabase
    .from("interviewers")
    .select("id,name,busy_slots")
    .order("id")
    .limit(2);
  const { data: roomRows } = await supabase
    .from("rooms")
    .select("id,name,busy_slots")
    .order("id")
    .limit(1);
  if (!people || people.length < 2 || !roomRows || !roomRows.length) {
    throw new Error("면접관 2명과 회의실 1개가 필요하다");
  }
  const [a, b] = people;
  const room = roomRows[0];
  const panel = [a.id, b.id];

  // 끝나고 되돌리기 위해 원래 값을 보관한다.
  const originalA = ((a.busy_slots as string[] | null) ?? []) as string[];
  const originalB = ((b.busy_slots as string[] | null) ?? []) as string[];
  const originalRoom = ((room.busy_slots as string[] | null) ?? []) as string[];
  const createdInterviews: string[] = [];

  console.log(`검증 대상 — 면접관 ${a.name}, ${b.name} / 회의실 ${room.name}`);
  console.log(`검증 시간 — ${SLOT} (구간 ${SPAN.length}칸)\n`);

  // 함수가 아예 없으면(마이그레이션 미실행) 아래 검증들이 "실패했다"는 이유만으로
  // 엉뚱하게 통과할 수 있다. 데이터를 건드리기 전에 먼저 확인하고 멈춘다.
  const probe = await supabase.rpc("confirm_interview", {
    p_interview_id: "00000000-0000-0000-0000-000000000000",
    p_slot: SLOT,
    p_span: SPAN,
    p_room_id: null,
    p_status: "confirmed",
    p_note: null,
    p_stage: null,
    p_preferred_slots: null,
    p_reset_confirmation: false,
    p_force: false,
    p_abort_for_test: false,
  });
  // 없는 면접 id라 PT404가 나오는 것이 정상이다. 그게 아니라 "함수를 못 찾겠다"면
  // 마이그레이션이 아직 실행되지 않은 것이다.
  if (probe.error && probe.error.code !== "PT404") {
    throw new Error(
      "confirm_interview 함수를 호출할 수 없다. " +
        "supabase/migration_confirm_transaction.sql을 Supabase SQL Editor에서 먼저 실행할 것.\n" +
        `원본 오류: ${probe.error.message}`,
    );
  }
  console.log("confirm_interview 함수 확인됨.\n");

  try {
    await setBusy("interviewers", a.id, []);
    await setBusy("interviewers", b.id, []);
    await setBusy("rooms", room.id, []);

    // ── 1. 원자성: 모든 쓰기를 마친 직후 실패하면 전부 되돌아가야 한다 ──────────
    console.log("[1] 중간에 실패하면 전부 되돌아간다 (반쪽 확정이 남지 않는다)");
    const ivA = await createInterview("A", panel);
    createdInterviews.push(ivA);

    const aborted = await callConfirm(ivA, room.id, { abort: true });
    // 코드까지 확인한다. "실패했다"만 보면 마이그레이션을 아직 안 돌려서 함수가
    // 없는 경우도 통과로 세어버린다 — 잘못된 이유로 통과하는 검증이 된다.
    assert(
      !aborted.ok && aborted.code === "PT500",
      `강제 중단이 의도한 지점에서 일어났다 (code=${aborted.code})`,
    );

    const rowAfterAbort = await interviewRow(ivA);
    assert(rowAfterAbort?.matched_slot === null, "면접 행에 확정 시간이 남지 않았다");
    assert(rowAfterAbort?.status === "pending", "면접 상태가 pending 그대로다");
    assert((await busyOf("interviewers", a.id)).length === 0, `${a.name}의 캘린더가 비어 있다`);
    assert((await busyOf("interviewers", b.id)).length === 0, `${b.name}의 캘린더가 비어 있다`);
    assert((await busyOf("rooms", room.id)).length === 0, "회의실 캘린더가 비어 있다");

    // ── 2. 정상 확정: 세 곳이 함께 갱신된다 ────────────────────────────────────
    console.log("\n[2] 정상 확정이면 면접 행·면접관·회의실이 함께 갱신된다");
    const ok = await callConfirm(ivA, room.id);
    assert(ok.ok, `확정이 성공한다${ok.message ? ` (${ok.message})` : ""}`);

    const rowAfterOk = await interviewRow(ivA);
    assert(rowAfterOk?.matched_slot === SLOT, "면접 행에 확정 시간이 들어갔다");
    assert(rowAfterOk?.status === "confirmed", "상태가 confirmed로 바뀌었다");
    assert(rowAfterOk?.stage === "candidate_done", "stage도 함께 갱신됐다");

    const aBusy = await busyOf("interviewers", a.id);
    const bBusy = await busyOf("interviewers", b.id);
    const roomBusy = await busyOf("rooms", room.id);
    assert(
      SPAN.every((s) => aBusy.includes(s)),
      `${a.name}의 캘린더에 구간 전체(${SPAN.length}칸)가 들어갔다`,
    );
    assert(
      SPAN.every((s) => bBusy.includes(s)),
      `${b.name}의 캘린더에도 구간 전체가 들어갔다`,
    );
    assert(
      SPAN.every((s) => roomBusy.includes(s)),
      "회의실 캘린더에도 구간 전체가 들어갔다",
    );

    // ── 3. 이중 배정 차단 ─────────────────────────────────────────────────────
    console.log("\n[3] 같은 시간에 또 확정하려 하면 막힌다");
    const ivB = await createInterview("B", panel);
    createdInterviews.push(ivB);

    const blocked = await callConfirm(ivB, room.id);
    assert(!blocked.ok, "겹치는 확정이 거부된다");
    assert(blocked.code === "PT409", `거부 사유가 코드로 구분된다 (code=${blocked.code})`);

    const rowB = await interviewRow(ivB);
    assert(rowB?.matched_slot === null, "거부된 쪽에는 아무것도 쓰이지 않았다");

    // ── 4. 수동 확정(force)은 겹쳐도 진행된다 ─────────────────────────────────
    console.log("\n[4] 리크루터의 수동 확정(force)은 겹쳐도 그대로 진행된다");
    const forced = await callConfirm(ivB, room.id, { force: true });
    assert(forced.ok, `force면 확정된다${forced.message ? ` (${forced.message})` : ""}`);
    assert((await interviewRow(ivB))?.matched_slot === SLOT, "force 확정이 실제로 저장됐다");

    // ── 5. 동시 확정: 정확히 하나만 성공 ──────────────────────────────────────
    console.log("\n[5] 두 확정이 같은 순간에 같은 시간을 노리면 하나만 성공한다");
    await setBusy("interviewers", a.id, []);
    await setBusy("interviewers", b.id, []);
    await setBusy("rooms", room.id, []);

    const ivC = await createInterview("C", panel);
    const ivD = await createInterview("D", panel);
    createdInterviews.push(ivC, ivD);

    const [rc, rd] = await Promise.all([callConfirm(ivC, room.id), callConfirm(ivD, room.id)]);
    const wins = [rc, rd].filter((r) => r.ok).length;
    const losses = [rc, rd].filter((r) => !r.ok && r.code === "PT409").length;
    assert(wins === 1, `동시에 부른 둘 중 정확히 하나만 성공했다 (성공 ${wins}건)`);
    assert(losses === 1, `나머지 하나는 겹침으로 거부됐다 (PT409 ${losses}건)`);

    const confirmedCount = (await Promise.all([interviewRow(ivC), interviewRow(ivD)])).filter(
      (r) => r?.matched_slot === SLOT,
    ).length;
    assert(confirmedCount === 1, "실제로 저장된 확정도 한 건뿐이다");

    console.log(`\n전부 통과 (${passed}개 확인)`);
  } finally {
    console.log("\n정리 중...");
    for (const id of createdInterviews) {
      await supabase.from("interviews").delete().eq("id", id);
    }
    await setBusy("interviewers", a.id, originalA);
    await setBusy("interviewers", b.id, originalB);
    await setBusy("rooms", room.id, originalRoom);
    console.log("원래 상태로 되돌렸다.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("\n" + (e instanceof Error ? e.message : String(e)));
    process.exit(1);
  });
