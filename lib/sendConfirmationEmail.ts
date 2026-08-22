import { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail, emailErrorReason } from "./email";
import { formatSlotRangeLabel, interviewDurationMinutes } from "./slots";
import { generateToken } from "./token";
import { checkSingleInterviewViolations } from "./checkConsistency";

type Interview = {
  id: string;
  candidate_name: string;
  candidate_email: string | null;
  position: string;
  panel: string[];
  matched_slot: string | null;
  room_id: string | null;
  interview_type: string;
  status: string;
  confirmation_sent_at: string | null;
};

/**
 * origin이 있으면(대부분의 호출 경로) 후보자 메일에만 "일정 변경 요청" 링크를 넣는다.
 * 면접관에게는 이 링크를 보내지 않는다 — 일정 변경 여부는 후보자가 판단할 몫이라서다.
 */
export async function sendConfirmationEmail(
  supabase: SupabaseClient,
  interview: Interview,
  origin?: string,
  options?: { force?: boolean },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!["confirmed", "rescheduled"].includes(interview.status) || !interview.matched_slot) {
    return { ok: false, error: "매칭이 완료된 케이스만 확정 메일을 보낼 수 있습니다." };
  }
  if (interview.confirmation_sent_at) {
    return { ok: false, error: "이미 확정 메일을 발송했습니다." };
  }

  // 가장 위험한 메일이라 발송 직전에 한 번 더, 이 건 하나만 콕 집어 모순이 없는지
  // 확인한다. 이 판단 자체가 틀릴 수 있어서(잘못 정의된 불변조건 등) 무조건 막지는
  // 않고, 이유를 그대로 보여주고 "정말 문제없다"고 판단하면 force로 넘어갈 길을
  // 열어둔다 — 사람의 최종 판단을 대신하는 게 아니라 돕는 용도이기 때문이다.
  if (!options?.force) {
    const violations = await checkSingleInterviewViolations(supabase, {
      id: interview.id,
      candidate_name: interview.candidate_name,
      interview_type: interview.interview_type,
      panel: interview.panel,
      matched_slot: interview.matched_slot,
      room_id: interview.room_id,
      status: interview.status as "confirmed" | "rescheduled" | "escalated" | "pending",
      confirmation_sent_at: interview.confirmation_sent_at,
    });
    if (violations.length) {
      const detail = violations.map((v) => v.detail).join(" / ");
      await supabase
        .from("interviews")
        .update({ note: `🚨 확정 메일 발송 보류 — 정합성 오류: ${detail}` })
        .eq("id", interview.id);
      return {
        ok: false,
        error: `정합성 오류로 발송을 보류했습니다: ${detail} — 문제가 없다고 판단되면 강제 발송으로 다시 시도해주세요.`,
      };
    }
  }

  let roomName = interview.interview_type;
  if (interview.room_id) {
    const { data: room } = await supabase
      .from("rooms")
      .select("name")
      .eq("id", interview.room_id)
      .single();
    roomName = room?.name ?? interview.interview_type;
  }

  const { data: panelInterviewers } = await supabase
    .from("interviewers")
    .select("name,email")
    .in("id", interview.panel);
  const panelEmails = (panelInterviewers ?? []).map((p) => p.email).filter((e): e is string => !!e);

  if (!interview.candidate_email && !panelEmails.length) {
    return { ok: false, error: "발송할 이메일 주소가 없습니다." };
  }

  // 시작 시각만 보내면 면접이 언제 끝나는지 알 수 없어, 뒤에 다른 일정을 잡는 사고가
  // 생긴다. 소요시간을 아는 이상 끝나는 시각까지 함께 안내한다.
  const when = formatSlotRangeLabel(
    interview.matched_slot,
    interviewDurationMinutes(interview.interview_type),
  );
  let rescheduleLink: string | null = null;
  if (origin && interview.candidate_email) {
    const token = generateToken();
    await supabase.from("response_requests").insert({ token, kind: "reschedule_request", interview_id: interview.id });
    rescheduleLink = `${origin}/respond/${token}`;
  }

  // 가장 위험한 메일(최종 확정)이라, 하나라도 실패하면 절대 조용히 넘기지 않는다.
  // 실패한 수신자를 note에 남겨 대시보드에 바로 보이게 하고, confirmation_sent_at은
  // 설정하지 않아 "확정 메일 발송" 버튼이 그대로 남아 재시도할 수 있게 한다.
  const failed: string[] = [];

  if (interview.candidate_email) {
    try {
      await sendEmail(
        interview.candidate_email,
        `[인터뷰싱크] ${interview.candidate_name}(${interview.position}) 면접 일정이 확정되었습니다`,
        `
          <p><b>${interview.candidate_name}</b>님(${interview.position}) 면접 일정이 아래와 같이 확정되었습니다.</p>
          <p><b>${when}</b> · ${roomName}</p>
          <p style="color:#888;font-size:12px">이 시간에 참석이 어려우시거나 문제가 있으면 리크루터에게 알려주세요.</p>
          ${rescheduleLink ? `<p><a href="${rescheduleLink}">일정 변경이 필요하신가요? 여기를 클릭해주세요</a></p>` : ""}
        `,
      );
    } catch (e) {
      failed.push(`후보자(${interview.candidate_email}, 사유: ${emailErrorReason(e)})`);
    }
  }

  for (const to of panelEmails) {
    try {
      await sendEmail(
        to,
        `[인터뷰싱크] ${interview.candidate_name}(${interview.position}) 면접 일정이 확정되었습니다`,
        `
          <p><b>${interview.candidate_name}</b>님(${interview.position}) 면접 일정이 아래와 같이 확정되었습니다.</p>
          <p><b>${when}</b> · ${roomName}</p>
          <p style="color:#888;font-size:12px">이 시간에 참석이 어려우시거나 문제가 있으면 리크루터에게 알려주세요.</p>
        `,
      );
    } catch (e) {
      failed.push(`면접관(${to}, 사유: ${emailErrorReason(e)})`);
    }
  }

  if (failed.length) {
    await supabase
      .from("interviews")
      .update({ note: `⚠️ 확정 메일 발송 실패: ${failed.join(", ")} — "확정 메일 발송"을 다시 눌러주세요` })
      .eq("id", interview.id);
    return { ok: false, error: `다음 수신자에게 발송 실패: ${failed.join(", ")}` };
  }

  await supabase
    .from("interviews")
    .update({ confirmation_sent_at: new Date().toISOString() })
    .eq("id", interview.id);

  return { ok: true };
}
