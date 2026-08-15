// "재발송" 기능이 만드는 orphan pending 행(발송 실패로 방치된 예전 요청)이 있어도
// 자동 확정 로직이 정상 동작하는지 검증하는 회귀 테스트.
//
// 배경: reinvite-priority-confirm으로 같은 면접관에게 새 토큰을 또 만들 수 있게
// 되면서, 예전 로직(모든 행이 submitted인지 확인)은 "발송 실패로 아무도 못 받은
// 예전 요청"이 pending으로 영원히 남아 자동 확정을 영구히 막는 버그가 있었다.
// computeInterviewerProgress를 "면접관별 최신 요청 기준"으로 고쳐서 해결했다.
//
// 실행 전 필요조건: scripts/verify-reschedule-flow.js와 동일.
// 실행: node scripts/verify-priority-confirm-resend.js

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
function assert(cond, msg) {
  if (!cond) throw new Error("FAIL: " + msg);
  console.log("OK:", msg);
}

async function main() {
  console.log("=== 재발송으로 예전 라운드의 pending 행이 남아도 정상 확정되는지 검증 ===");
  await sb(`/interviewers?id=eq.${A}`, {
    method: "PATCH",
    body: JSON.stringify({ email: "pihayoung@naver.com", busy_slots: [] }),
  });
  await sb(`/interviewers?id=eq.${B}`, {
    method: "PATCH",
    body: JSON.stringify({ email: "pihayoung@naver.com", busy_slots: [] }),
  });

  const slotsRes = await fetch(BASE + "/api/slots");
  const slot = (await slotsRes.json())[0].key;

  const ivRes = await sb("/interviews", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      candidate_name: "__우선순위재발송버그검증__",
      candidate_email: null,
      position: "검증",
      panel: [A, B],
      interview_type: "1차 대면",
      preferred_slots: [slot],
      status: "pending",
      stage: "priority_confirm_pending",
      excluded_slots: [],
    }),
  });
  const iv = ivRes.data[0];

  // 1. A, B 모두에게 최초 priority_confirm 요청 생성(구 라운드 — 앞으로 pending으로 방치될 예정)
  const oldTokenA = "old_a_" + Math.random().toString(36).slice(2);
  const oldTokenB = "old_b_" + Math.random().toString(36).slice(2);
  await sb("/response_requests", {
    method: "POST",
    body: JSON.stringify([
      { token: oldTokenA, kind: "priority_confirm", interview_id: iv.id, interviewer_id: A, confirm_slots: [slot] },
      { token: oldTokenB, kind: "priority_confirm", interview_id: iv.id, interviewer_id: B, confirm_slots: [slot] },
    ]),
  });

  // 2. A에 대해 "재발송" API로 새 토큰을 만든다 — 이제 A는 pending 행이 2개(구 토큰 + 신규 토큰)
  const reinviteRes = await fetch(BASE + `/api/interviews/${iv.id}/reinvite-priority-confirm`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ interviewerId: A }),
  });
  assert(reinviteRes.status === 200, "A 재발송 API 200");

  const aRows = await sb(
    `/response_requests?interview_id=eq.${iv.id}&kind=eq.priority_confirm&interviewer_id=eq.${A}&select=token,status`,
  );
  assert(aRows.data.length === 2, `A에 대해 pending 행이 2개(구+신규) 존재 (실제: ${aRows.data.length}개)`);
  const newTokenA = aRows.data.find((r) => r.token !== oldTokenA).token;

  // 3. A는 "새 토큰"으로만 응답 제출 (구 토큰은 영원히 pending으로 남음 — 예전 버그 재현 조건)
  const postA = await fetch(BASE + `/api/respond/${newTokenA}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ availableSlots: [slot] }),
  });
  assert(postA.status === 200, "A(신규 토큰) 응답 제출 성공");

  // 4. B도 응답 제출 (구 토큰 그대로, 재발송 없었음)
  const postB = await fetch(BASE + `/api/respond/${oldTokenB}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ availableSlots: [slot] }),
  });
  assert(postB.status === 200, "B 응답 제출 성공");

  // 5. 이제 A의 "구 토큰"은 영원히 pending인 상태 — 예전 버그라면 여기서 절대 확정이 안 됐어야 한다.
  const ivFinal = await sb(`/interviews?id=eq.${iv.id}&select=status,matched_slot`);
  assert(
    ivFinal.data[0].status === "confirmed" || ivFinal.data[0].status === "rescheduled",
    `구 토큰이 pending으로 남아있어도 정상적으로 자동 확정됨 (실제 status: ${ivFinal.data[0].status})`,
  );
  assert(ivFinal.data[0].matched_slot === slot, `matched_slot이 올바름 (${ivFinal.data[0].matched_slot})`);

  await sb(`/response_requests?interview_id=eq.${iv.id}`, { method: "DELETE" });
  await sb(`/interviews?id=eq.${iv.id}`, { method: "DELETE" });
  await sb(`/interviewers?id=eq.${A}`, { method: "PATCH", body: JSON.stringify({ email: null, busy_slots: [] }) });
  await sb(`/interviewers?id=eq.${B}`, { method: "PATCH", body: JSON.stringify({ email: null, busy_slots: [] }) });
  console.log("\n모든 검증 통과 — 재발송으로 생긴 orphan pending 행이 자동 확정을 막지 않음");
}

main().catch((e) => {
  console.error("\n" + e.message);
  process.exit(1);
});
