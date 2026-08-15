// 확정된 일정을 후보자가 변경 요청했을 때, 겹치는 시간이 이미 있어도(라이브 데이터 기준)
// 면접관에게 다시 묻지 않고 조용히 확정해버리지 않는지 검증하는 실제 API 통합 테스트.
//
// 단위 테스트(lib/*.test.ts)로는 커버가 안 되는 부분 — 여러 API 라우트와 Supabase를
// 실제로 오가는 전체 흐름 — 을 검증한다. Vitest처럼 자동으로 도는 건 아니고, 로컬
// 개발 서버(npm run dev)를 띄운 상태에서 수동으로 실행하는 통합 검증 스크립트다.
//
// 실행 전 필요조건:
//   - 로컬 dev 서버가 http://localhost:3000 에서 실행 중이어야 함
//   - .env.local에 실제 Supabase 프로젝트 키가 있어야 함
//   - 아래 A, B는 시드 데이터의 실제 면접관 id(정민지, 신동혁)를 가리킴 — 다른 프로젝트/
//     DB에서 실행하려면 이 id를 실제 존재하는 면접관으로 바꿔야 한다
//
// 실행: node scripts/verify-reschedule-flow.js
// (테스트용으로 만든 면접 케이스와 이메일 설정은 스크립트가 끝에서 알아서 정리한다.)

const fs = require("fs");
const path = require("path");
const env = fs.readFileSync(path.join(__dirname, "..", ".env.local"), "utf8");
const SUPA_URL = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.*)/)[1].trim();
const SUPA_KEY = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.*)/)[1].trim();
const H = { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY, "Content-Type": "application/json" };
const BASE = "http://localhost:3000";

const A = "58038055-dc29-4b2e-990b-5b1890b0831f"; // 정민지
const B = "1f3585a0-1706-4e4d-81e0-4cec13588ed8"; // 신동혁

async function sb(p, opts = {}) {
  const res = await fetch(SUPA_URL + "/rest/v1" + p, { ...opts, headers: { ...H, ...(opts.headers || {}) } });
  const text = await res.text();
  try {
    return { status: res.status, data: JSON.parse(text) };
  } catch {
    return { status: res.status, data: text };
  }
}

async function setEmail(id, email) {
  await sb(`/interviewers?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ email }) });
}
async function resetInterviewer(id) {
  await sb(`/interviewers?id=eq.${id}`, { method: "PATCH", body: JSON.stringify({ busy_slots: [], email: null }) });
}
async function cleanup(interviewId) {
  await sb(`/response_requests?interview_id=eq.${interviewId}`, { method: "DELETE" });
  await sb(`/interviews?id=eq.${interviewId}`, { method: "DELETE" });
}
function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("OK:", msg);
}

async function main() {
  console.log("=== 겹치는 시간이 이미 있어도 면접관에게 항상 재확인하는지 검증 ===");
  await setEmail(A, "pihayoung@naver.com");
  await setEmail(B, "pihayoung@naver.com");

  const slotsRes = await fetch(BASE + "/api/slots");
  const slots = (await slotsRes.json()).map((s) => s.key);
  const oldSlot = slots[0];
  const goodSlot = slots[5]; // 라이브 데이터상 둘 다 비어있는 시간(과거엔 여기서 즉시 확정됐음)

  const ivRes = await sb("/interviews", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      candidate_name: "__리스케줄검증__",
      candidate_email: null,
      position: "검증",
      panel: [A, B],
      interview_type: "1차 대면",
      preferred_slots: [oldSlot],
      matched_slot: oldSlot,
      status: "confirmed",
      stage: "priority_confirm_pending",
      excluded_slots: [],
    }),
  });
  const iv = ivRes.data[0];

  await sb(`/interviewers?id=eq.${A}`, { method: "PATCH", body: JSON.stringify({ busy_slots: [oldSlot] }) });
  await sb(`/interviewers?id=eq.${B}`, { method: "PATCH", body: JSON.stringify({ busy_slots: [oldSlot] }) });

  const token = "resched_" + Math.random().toString(36).slice(2);
  await sb("/response_requests", {
    method: "POST",
    body: JSON.stringify({ token, kind: "reschedule_request", interview_id: iv.id }),
  });

  // goodSlot은 라이브 데이터상 둘 다 비어있지만, 그걸로 조용히 확정하면 안 된다.
  const postRes = await fetch(BASE + `/api/respond/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ availableSlots: [goodSlot] }),
  });
  assert(postRes.status === 200, "POST 200");

  const ivAfter = await sb(`/interviews?id=eq.${iv.id}&select=*`);
  const updated = ivAfter.data[0];
  assert(updated.status === "pending", `조용히 확정되지 않고 status가 pending으로 유지됨 (실제: ${updated.status})`);
  assert(updated.matched_slot === null, `matched_slot이 아직 null (실제: ${updated.matched_slot})`);
  assert(updated.stage === "priority_confirm_pending", `stage가 priority_confirm_pending (실제: ${updated.stage})`);
  assert(
    JSON.stringify(updated.preferred_slots) === JSON.stringify([goodSlot]),
    "preferred_slots가 후보자가 체크한 시간(goodSlot)으로 설정됨",
  );

  const prReq = await sb(
    `/response_requests?interview_id=eq.${iv.id}&kind=eq.priority_confirm&select=interviewer_id,status,confirm_slots`,
  );
  assert(prReq.data.length === 2, `면접관 2명 모두에게 priority_confirm 요청 생성됨 (실제: ${prReq.data.length}건)`);
  assert(
    prReq.data.every((r) => r.status === "pending" && JSON.stringify(r.confirm_slots) === JSON.stringify([goodSlot])),
    "각 요청이 pending 상태이고 goodSlot 하나를 confirm_slots로 담고 있음(둘 다 응답해야 확정됨)",
  );

  // A만 응답 -> 아직 확정되면 안 됨(전원 응답 전)
  const reqRowA = await sb(
    `/response_requests?interview_id=eq.${iv.id}&kind=eq.priority_confirm&interviewer_id=eq.${A}&select=token`,
  );
  const postA = await fetch(BASE + `/api/respond/${reqRowA.data[0].token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ availableSlots: [goodSlot] }),
  });
  assert(postA.status === 200, "A 응답 POST 200");

  const ivAfterA = await sb(`/interviews?id=eq.${iv.id}&select=status,matched_slot`);
  assert(ivAfterA.data[0].status === "pending", "A만 응답했을 때는 아직 확정 안 됨(B 대기 중)");

  // B도 응답 -> 이제 전원 가능 확인됐으니 자동 확정
  const reqRowB = await sb(
    `/response_requests?interview_id=eq.${iv.id}&kind=eq.priority_confirm&interviewer_id=eq.${B}&select=token`,
  );
  const postB = await fetch(BASE + `/api/respond/${reqRowB.data[0].token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ availableSlots: [goodSlot] }),
  });
  assert(postB.status === 200, "B 응답 POST 200");

  const ivFinal = await sb(`/interviews?id=eq.${iv.id}&select=status,matched_slot`);
  assert(
    ivFinal.data[0].status === "confirmed" || ivFinal.data[0].status === "rescheduled",
    `전원 응답 후 자동 확정됨 (실제 status: ${ivFinal.data[0].status})`,
  );
  assert(ivFinal.data[0].matched_slot === goodSlot, `matched_slot이 goodSlot (실제: ${ivFinal.data[0].matched_slot})`);

  await cleanup(iv.id);
  await resetInterviewer(A);
  await resetInterviewer(B);
  console.log("\n모든 검증 통과 — 겹치는 시간이 있어도 면접관 전원 응답을 기다린 뒤에만 확정됨");
}

main().catch((e) => {
  console.error("\n" + e.message);
  process.exit(1);
});
