import { SupabaseClient } from "@supabase/supabase-js";
import { generateToken } from "./token";
import { sendEmail, emailErrorReason } from "./email";
import { formatSlotLabel } from "./slots";

type Interview = {
  id: string;
  candidate_name: string;
  position: string;
  panel: string[];
  preferred_slots: string[];
};

export const RANK_MEDAL = ["🥇", "🥈", "🥉"];

/**
 * 후보자가 제출한 1~3순위 시간을 면접관 전원에게 보내, 각 시간에 참석 가능한지
 * 확인 요청한다. 리크루터가 수동으로 확정하는 대신, 전원이 응답을 마치면
 * confirmFromPriorities가 전원 가능한 가장 높은 순위로 자동 확정한다.
 */
export async function requestPriorityConfirmation(
  supabase: SupabaseClient,
  interview: Interview,
  origin: string,
): Promise<{ ok: true; sent: number } | { ok: false; error: string }> {
  const { data: panelInterviewers, error } = await supabase
    .from("interviewers")
    .select("*")
    .in("id", interview.panel);
  if (error) return { ok: false, error: error.message };

  const list = interview.preferred_slots
    .map((s, i) => `${RANK_MEDAL[i] ?? `${i + 1}순위`} ${formatSlotLabel(s)}`)
    .join("<br/>");

  let sent = 0;
  const failed: { name: string; reason: string }[] = [];
  for (const interviewer of panelInterviewers) {
    if (!interviewer.email) continue;
    const token = generateToken();
    const { error: insErr } = await supabase.from("response_requests").insert({
      token,
      kind: "priority_confirm",
      interview_id: interview.id,
      interviewer_id: interviewer.id,
      confirm_slots: interview.preferred_slots,
    });
    // 요청 자체가 저장 안 됐는데 메일을 보내면, 나중에 확인 답변을 받을 방법이 없는
    // 요청이 나가버린다 — 이 사람은 건너뛰고 계속한다(한 명 실패가 전체를 막지 않도록).
    if (insErr) continue;

    const link = `${origin}/respond/${token}`;
    try {
      await sendEmail(
        interviewer.email,
        `[인터뷰싱크] ${interview.candidate_name}(${interview.position}) 최종 면접 시간 확인 요청`,
        `
          <p>안녕하세요, ${interviewer.name}님.</p>
          <p><b>${interview.candidate_name}</b>님(${interview.position})이 아래 순서로 면접 시간을 제안했습니다.</p>
          <p>${list}</p>
          <p>참석 가능한 시간을 모두 확인해주세요.</p>
          <p><a href="${link}">${link}</a></p>
        `,
      );
      await supabase.from("response_requests").update({ email_sent_at: new Date().toISOString() }).eq("token", token);
      sent += 1;
    } catch (e) {
      failed.push({ name: interviewer.name, reason: emailErrorReason(e) });
    }
  }

  const failedText = failed.map((f) => `${f.name}(사유: ${f.reason})`).join(", ");
  await supabase
    .from("interviews")
    .update({
      stage: "priority_confirm_pending",
      ...(failed.length
        ? {
            note: `⚠️ 최종 확인 요청 메일 발송 실패: ${failedText} — 상세보기에서 "재발송" 버튼을 눌러주세요`,
          }
        : {}),
    })
    .eq("id", interview.id);

  if (failed.length) {
    return { ok: false, error: `다음 면접관에게 메일 발송 실패: ${failedText}` };
  }
  return { ok: true, sent };
}
