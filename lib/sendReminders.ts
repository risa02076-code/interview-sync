import { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, emailErrorReason } from "./email";
import { formatSlotLabel } from "./slots";

/** 응답이 없을 때 며칠 뒤 처음 독촉할지 */
const FIRST_NUDGE_DAYS = 2;
/** 그 뒤로 몇 일 간격으로 다시 독촉할지 */
const NUDGE_INTERVAL_DAYS = 2;
/** 끝내 응답하지 않는 건에 메일이 무한히 나가지 않도록 두는 상한 */
const MAX_NUDGES = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export type ReminderResult = { sent: number; skipped: number; errors: string[] };

/**
 * 서버 타임존과 무관하게 "한국 기준 몇 월 며칠인지"를 YYYY-MM-DD로 뽑는다.
 * Vercel 서버는 UTC로 도는데, 전날 알림을 서버 로컬 날짜로 비교하면 하루가 밀린다.
 */
function kstDateKey(d: Date): string {
  return new Date(d.getTime() + KST_OFFSET_MS).toISOString().slice(0, 10);
}

/**
 * 아직 응답하지 않은 면접관·후보자에게 독촉 메일을 보낸다.
 *
 * 처음 요청받고 FIRST_NUDGE_DAYS 일이 지나도록 응답이 없으면 1차 독촉을 보내고,
 * 이후 NUDGE_INTERVAL_DAYS 간격으로 MAX_NUDGES 회까지 재발송한다.
 * 응답 링크는 최초 발송 때 만든 토큰을 그대로 재사용한다 (새 토큰을 만들면 앞서 보낸
 * 메일의 링크가 유효한 채로 남아 어느 쪽으로 응답했는지 추적이 어긋난다).
 */
export async function sendPendingResponseReminders(
  supabase: SupabaseClient,
  origin: string,
): Promise<ReminderResult> {
  const now = Date.now();

  const { data: pending, error } = await supabase
    .from("response_requests")
    .select("*")
    .eq("status", "pending")
    .lt("reminder_count", MAX_NUDGES);
  if (error) return { sent: 0, skipped: 0, errors: [error.message] };

  const all = pending ?? [];
  const due = all.filter((r) => {
    // 한 번도 안 보냈으면 최초 요청 시각, 보냈으면 마지막 발송 시각이 기준
    const since = r.reminded_at ?? r.created_at;
    const waitDays = r.reminded_at ? NUDGE_INTERVAL_DAYS : FIRST_NUDGE_DAYS;
    return now - new Date(since).getTime() >= waitDays * DAY_MS;
  });
  if (!due.length) return { sent: 0, skipped: all.length, errors: [] };

  const interviewIds = [...new Set(due.map((r) => r.interview_id).filter(Boolean))];
  const interviewerIds = [...new Set(due.map((r) => r.interviewer_id).filter(Boolean))];

  const { data: interviews } = interviewIds.length
    ? await supabase
        .from("interviews")
        .select("id,candidate_name,candidate_email,position")
        .in("id", interviewIds)
    : { data: [] };
  const { data: interviewers } = interviewerIds.length
    ? await supabase.from("interviewers").select("id,name,email").in("id", interviewerIds)
    : { data: [] };

  let sent = 0;
  const errors: string[] = [];
  // 크론은 여러 케이스를 한 번에 처리하므로, 실패를 케이스별로 모아뒀다가 각 케이스의
  // note에 남긴다 — 이게 없으면 리마인더 발송 실패는 대시보드 어디에도 안 보이고
  // 크론의 HTTP 응답(아무도 안 보는)에만 남는다.
  const failedByInterview = new Map<string, string[]>();

  for (const req of due) {
    const interview = interviews?.find((iv) => iv.id === req.interview_id);
    // 케이스가 삭제됐는데 요청만 남은 경우는 조용히 건너뛴다
    if (!interview) continue;

    const interviewer = interviewers?.find((p) => p.id === req.interviewer_id);
    const isInterviewer = req.kind === "interviewer";
    const to = isInterviewer ? interviewer?.email : interview.candidate_email;
    const name = isInterviewer ? interviewer?.name : interview.candidate_name;

    if (!to) {
      errors.push(`${name ?? req.token}: 이메일 주소가 없어 건너뜀`);
      continue;
    }

    const link = `${origin}/respond/${req.token}`;
    const nth = req.reminder_count + 1;
    const subject = isInterviewer
      ? `[인터뷰싱크] (재안내) ${interview.candidate_name}(${interview.position}) 면접 - 불가능한 시간을 알려주세요`
      : `[인터뷰싱크] (재안내) ${interview.candidate_name}님, 면접 희망 시간을 알려주세요`;
    const body = isInterviewer
      ? `
        <p>안녕하세요, ${name}님.</p>
        <p><b>${interview.candidate_name}</b>님(${interview.position}) 면접 관련해서 앞서 보내드린 요청에 아직 응답이 없어 다시 안내드립니다.</p>
        <p>아래 링크에서 <b>불가능한</b> 시간을 선택해주세요.</p>
        <p><a href="${link}">${link}</a></p>
      `
      : `
        <p>안녕하세요, ${name}님.</p>
        <p>${interview.position} 직무 면접 일정 관련해서 앞서 보내드린 요청에 아직 응답이 없어 다시 안내드립니다.</p>
        <p>아래 링크에서 <b>가능한</b> 시간을 선택해주세요.</p>
        <p><a href="${link}">${link}</a></p>
      `;

    try {
      await sendEmail(to, subject, body);
      await supabase
        .from("response_requests")
        .update({
          reminded_at: new Date().toISOString(),
          reminder_count: nth,
          email_sent_at: new Date().toISOString(),
        })
        .eq("id", req.id);
      sent += 1;
    } catch (e) {
      // 한 건이 실패해도 나머지는 계속 보낸다. reminded_at/reminder_count를 안
      // 올렸으니 다음 크론 실행 때 자동으로 다시 시도된다.
      const reason = emailErrorReason(e);
      errors.push(`${name ?? req.token}: ${reason}`);
      if (req.interview_id) {
        const list = failedByInterview.get(req.interview_id) ?? [];
        list.push(`${name ?? req.token}(사유: ${reason})`);
        failedByInterview.set(req.interview_id, list);
      }
    }
  }

  for (const [interviewId, names] of failedByInterview) {
    await supabase
      .from("interviews")
      .update({
        note: `⚠️ 독촉 메일 발송 실패: ${names.join(", ")} — 다음 리마인더 발송 때 자동으로 다시 시도됩니다`,
      })
      .eq("id", interviewId);
  }

  return { sent, skipped: all.length - due.length, errors };
}

/**
 * 내일(한국 기준) 면접이 잡힌 확정 케이스의 후보자·면접관 전원에게 리마인드 메일을 보낸다.
 * day_before_reminded_at 으로 케이스당 1회만 나가도록 막는다.
 */
export async function sendDayBeforeReminders(
  supabase: SupabaseClient,
): Promise<ReminderResult> {
  const tomorrowKey = kstDateKey(new Date(Date.now() + DAY_MS));

  const { data: confirmed, error } = await supabase
    .from("interviews")
    .select("*")
    .in("status", ["confirmed", "rescheduled"])
    .not("matched_slot", "is", null)
    .is("day_before_reminded_at", null);
  if (error) return { sent: 0, skipped: 0, errors: [error.message] };

  const all = confirmed ?? [];
  const due = all.filter((iv) => kstDateKey(new Date(iv.matched_slot)) === tomorrowKey);
  if (!due.length) return { sent: 0, skipped: all.length, errors: [] };

  const panelIds = [...new Set(due.flatMap((iv) => (iv.panel as string[]) ?? []))];
  const roomIds = [...new Set(due.map((iv) => iv.room_id).filter(Boolean))];

  const { data: interviewers } = panelIds.length
    ? await supabase.from("interviewers").select("id,name,email").in("id", panelIds)
    : { data: [] };
  const { data: rooms } = roomIds.length
    ? await supabase.from("rooms").select("id,name").in("id", roomIds)
    : { data: [] };

  let sent = 0;
  const errors: string[] = [];

  for (const iv of due) {
    const when = formatSlotLabel(iv.matched_slot);
    // 대면이 아니면 회의실이 없으므로 면접 유형을 장소 자리에 표시한다
    const where = rooms?.find((r) => r.id === iv.room_id)?.name ?? iv.interview_type;
    const panel = ((iv.panel as string[]) ?? [])
      .map((id) => interviewers?.find((p) => p.id === id))
      .filter((p): p is { id: string; name: string; email: string | null } => !!p);

    const recipients = [
      iv.candidate_email as string | null,
      ...panel.map((p) => p.email),
    ].filter((e): e is string => !!e);

    if (!recipients.length) {
      errors.push(`${iv.candidate_name}: 발송할 이메일 주소가 없어 건너뜀`);
      continue;
    }

    const body = `
      <p><b>${iv.candidate_name}</b>님(${iv.position}) 면접이 <b>내일</b>로 예정되어 있어 안내드립니다.</p>
      <p><b>${when}</b> · ${where}</p>
      <p>면접관: ${panel.map((p) => p.name).join(", ") || "-"}</p>
    `;

    // 한 명에게 실패해도 나머지 수신자에게는 계속 보낸다(면접이 내일이라 한 명이라도
    // 더 받는 게 낫다) — 실패자만 모아서 케이스 note에 남긴다.
    const failedRecipients: string[] = [];
    for (const to of recipients) {
      try {
        await sendEmail(
          to,
          `[인터뷰싱크] 내일 면접 안내 - ${iv.candidate_name}(${iv.position})`,
          body,
        );
      } catch (e) {
        failedRecipients.push(`${to}(사유: ${emailErrorReason(e)})`);
      }
    }

    if (failedRecipients.length) {
      errors.push(`${iv.candidate_name}: ${failedRecipients.join(", ")}`);
    } else {
      sent += 1;
    }

    // 시간대 자체가 "내일"에만 해당하므로 오늘 실패해도 내일 다시 시도할 기회가 없다
    // (그때는 이미 면접 당일이라 이 함수의 대상에서 빠짐) — 그래서 부분 실패여도
    // day_before_reminded_at은 그대로 남겨 반복 발송을 막고, 대신 note로 즉시 알린다.
    await supabase
      .from("interviews")
      .update({
        day_before_reminded_at: new Date().toISOString(),
        ...(failedRecipients.length
          ? {
              note: `⚠️ 전날 리마인더 발송 실패: ${failedRecipients.join(", ")} — 자동 재시도가 없으니 직접 연락해주세요`,
            }
          : {}),
      })
      .eq("id", iv.id);
  }

  return { sent, skipped: all.length - due.length, errors };
}
