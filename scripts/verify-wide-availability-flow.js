// 후보자가 처음 추천받은 시간을 전부 거절했을 때, 같은 응답 링크가
// "다음 주 가능한 시간 체크" 단계로 자연스럽게 전환되고, 체크한 시간이
// 면접관 전원에게 정확히 재확인 요청되는지 검증하는 실제 API 통합 테스트.
//
// 실행 전 필요조건: scripts/verify-reschedule-flow.js와 동일(로컬 dev 서버 실행 중,
// .env.local에 실제 Supabase 키, 아래 A/B는 시드 데이터의 정민지/신동혁 id).
//
// 실행: node scripts/verify-wide-availability-flow.js

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

async function makeCandidateCase(name) {
  const ivRes = await sb("/interviews", {
    method: "POST",
    headers: { Prefer: "return=representation" },
    body: JSON.stringify({
      candidate_name: name,
      candidate_email: null,
      position: "검증",
      panel: [A, B],
      interview_type: "1차 대면",
      preferred_slots: [],
      status: "pending",
      stage: "candidate_pending",
      availability_round: 1,
      excluded_slots: [],
    }),
  });
  const iv = ivRes.data[0];
  const token = "cand_" + Math.random().toString(36).slice(2);
  await sb("/response_requests", {
    method: "POST",
    body: JSON.stringify({ token, kind: "candidate", interview_id: iv.id }),
  });
  return { iv, token };
}

async function testGoesToWideAvailability() {
  console.log("\n=== 후보자가 '전부 안돼요' 클릭 -> candidate_wide_availability로 전환 ===");
  const { iv, token } = await makeCandidateCase("__와이드가용성검증1__");

  const postRes = await fetch(BASE + `/api/respond/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allUnavailable: true }),
  });
  assert(postRes.status === 200, "allUnavailable POST 200");

  const reqRow = await sb(`/response_requests?token=eq.${token}&select=kind,status`);
  assert(
    reqRow.data[0].kind === "candidate_wide_availability",
    `kind이 candidate_wide_availability로 바뀜 (실제: ${reqRow.data[0].kind})`,
  );
  assert(reqRow.data[0].status === "pending", `아직 status는 pending(제출 아님) (실제: ${reqRow.data[0].status})`);

  const getRes = await fetch(BASE + `/api/respond/${token}`);
  const ctx = await getRes.json();
  assert(ctx.kind === "candidate_wide_availability", "GET도 candidate_wide_availability 반환");
  assert(Array.isArray(ctx.slots) && ctx.slots.length > 0, `다음 주 슬롯 반환 (${ctx.slots?.length}개)`);
  const firstSlotDate = new Date(ctx.slots[0].key);
  const daysFromNow = (firstSlotDate - Date.now()) / (1000 * 60 * 60 * 24);
  assert(daysFromNow >= 6, `첫 슬롯이 오늘로부터 6일 이상 뒤 (실제: ${daysFromNow.toFixed(1)}일)`);

  await cleanup(iv.id);
  console.log("PASS");
}

async function testWideAvailabilitySlotsSubmitted() {
  console.log("\n=== 다음 주 시간 체크해서 제출 -> 면접관 전원에게 확인 요청 ===");
  await setEmail(A, "pihayoung@naver.com");
  await setEmail(B, "pihayoung@naver.com");
  const { iv, token } = await makeCandidateCase("__와이드가용성검증2__");

  await fetch(BASE + `/api/respond/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allUnavailable: true }),
  });

  const getRes = await fetch(BASE + `/api/respond/${token}`);
  const ctx = await getRes.json();
  const pickedSlot = ctx.slots[3].key;

  const postRes = await fetch(BASE + `/api/respond/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ availableSlots: [pickedSlot] }),
  });
  assert(postRes.status === 200, "availableSlots POST 200");

  const ivAfter = await sb(`/interviews?id=eq.${iv.id}&select=*`);
  assert(
    JSON.stringify(ivAfter.data[0].preferred_slots) === JSON.stringify([pickedSlot]),
    "interview.preferred_slots가 후보자가 체크한 시간으로 설정됨",
  );
  assert(
    ivAfter.data[0].stage === "priority_confirm_pending",
    `stage가 priority_confirm_pending (실제: ${ivAfter.data[0].stage})`,
  );

  const prReq = await sb(
    `/response_requests?interview_id=eq.${iv.id}&kind=eq.priority_confirm&select=interviewer_id,confirm_slots`,
  );
  assert(prReq.data.length === 2, `면접관 2명에게 priority_confirm 요청 생성 (실제: ${prReq.data.length}건)`);

  await cleanup(iv.id);
  await resetInterviewer(A);
  await resetInterviewer(B);
  console.log("PASS");
}

async function testEscalationNote() {
  console.log("\n=== 다음 주도 안 됨 + 자유 입력 -> 리크루터 에스컬레이션 & 대시보드 노출 ===");
  const { iv, token } = await makeCandidateCase("__와이드가용성검증3__");

  await fetch(BASE + `/api/respond/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allUnavailable: true }),
  });

  const postRes = await fetch(BASE + `/api/respond/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ availableSlots: [], candidateNote: "가능한 시점: 2026-08-31 / 사유: 해외 출장" }),
  });
  assert(postRes.status === 200, "candidateNote POST 200");

  const ivAfter = await sb(`/interviews?id=eq.${iv.id}&select=*`);
  assert(ivAfter.data[0].status === "escalated", `status가 escalated (실제: ${ivAfter.data[0].status})`);
  assert(ivAfter.data[0].note.includes("해외 출장"), `note에 후보자 자유 입력 내용이 포함됨 (실제: ${ivAfter.data[0].note})`);

  const listRes = await fetch(BASE + "/api/interviews");
  const list = await listRes.json();
  const row = list.find((r) => r.id === iv.id);
  assert(!!row, "목록 API에서 해당 케이스를 찾음");
  assert(row.note && row.note.includes("해외 출장"), "목록 API 응답에도 note가 그대로 포함됨(대시보드에서 노출 가능)");

  await cleanup(iv.id);
  console.log("PASS");
}

async function main() {
  await testGoesToWideAvailability();
  await testWideAvailabilitySlotsSubmitted();
  await testEscalationNote();
  console.log("\n모든 검증 통과");
}

main().catch((e) => {
  console.error("\n" + e.message);
  process.exit(1);
});
