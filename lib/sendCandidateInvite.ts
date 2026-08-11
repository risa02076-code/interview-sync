import { SupabaseClient } from "@supabase/supabase-js";
import { generateToken } from "./token";
import { sendEmail } from "./email";
import { formatSlotLabel } from "./slots";
import { recommendLeastConflictSlot, requiresRoom, type Interviewer, type Room } from "./matching";

type Interview = {
  id: string;
  candidate_name: string;
  candidate_email: string | null;
  position: string;
  panel: string[];
  interview_type: string;
};

/**
 * 패널 전원의 가능 시간 데이터를 바탕으로 "충돌이 가장 적은 시간" 하나를 추천해
 * 후보자에게 곧바로 안내한다. 후보자가 여러 시간 중 고르게 하던 이전 방식과 달리,
 * 후보자는 제안된 시간 하나만 확인·확정하면 된다(리크루터의 반복 조율 부담을 줄이는 것이 목표).
 */
export async function sendCandidateInvite(
  supabase: SupabaseClient,
  interview: Interview,
  origin: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!interview.candidate_email) {
    return { ok: false, error: "후보자 이메일이 등록되어 있지 않습니다." };
  }

  const needsRoom = requiresRoom(interview.interview_type);
  const { data: panelInterviewers } = await supabase
    .from("interviewers")
    .select("id,name,busy_slots")
    .in("id", interview.panel);
  const { data: rooms } = needsRoom ? await supabase.from("rooms").select("*") : { data: null };

  const recommendation = recommendLeastConflictSlot(
    (panelInterviewers ?? []) as Interviewer[],
    (rooms ?? []) as Room[],
    needsRoom,
  );
  if (!recommendation) {
    return { ok: false, error: "추천할 수 있는 시간대가 없습니다." };
  }
  const hasConflict = recommendation.conflicts.length > 0;

  const token = generateToken();
  const { error: insErr } = await supabase.from("response_requests").insert({
    token,
    kind: "candidate",
    interview_id: interview.id,
  });
  if (insErr) return { ok: false, error: insErr.message };

  const link = `${origin}/respond/${token}`;
  const when = formatSlotLabel(recommendation.slot);
  await sendEmail(
    interview.candidate_email,
    `[인터뷰싱크] ${interview.position} 면접 일정을 제안드립니다`,
    `
      <p>안녕하세요, ${interview.candidate_name}님.</p>
      <p><b>${interview.position}</b> 면접(${interview.interview_type}) 일정을 아래와 같이 제안드립니다.</p>
      <p><b>${when}</b></p>
      <p>아래 링크에서 확인 후 확정해주세요.</p>
      <p><a href="${link}">${link}</a></p>
    `,
  );

  // 제안 시점의 시간을 고정해서 저장해둔다. 후보자가 링크를 다시 열어봐도(면접관 가용
  // 시간이 그 사이 바뀌었더라도) 처음 안내받은 시간과 동일한 값을 보게 하기 위함.
  await supabase
    .from("interviews")
    .update({
      stage: "candidate_pending",
      recommended_slot: recommendation.slot,
      note: hasConflict
        ? `면접관 전원 동시 가능 시간 없음 — 충돌 최소 시간으로 임시 제안함 (겹침: ${recommendation.conflicts.join(", ")})`
        : null,
    })
    .eq("id", interview.id);

  return { ok: true };
}
