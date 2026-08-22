import { SupabaseClient } from "@supabase/supabase-js";
import { generateToken } from "./token";
import { sendEmail, emailErrorReason } from "./email";
import { formatSlotLabel, interviewDurationMinutes } from "./slots";
import { recommendLeastConflictSlots, requiresRoom, type Interviewer, type Room } from "./matching";

type Interview = {
  id: string;
  candidate_name: string;
  candidate_email: string | null;
  position: string;
  panel: string[];
  interview_type: string;
  excluded_slots?: string[] | null;
};

/**
 * 패널 전원의 가능 시간 데이터를 바탕으로 "충돌이 가장 적은 시간(들)"을 추천해
 * 후보자에게 곧바로 안내한다. 전원 동시 가능한 시간이 여러 개면 그 여러 개를 모두
 * 제안하고, 후보자는 그중 하나를 확인·확정한다(리크루터가 매번 전체 가능 시간을
 * 취합해 안내하던 반복 업무를 줄이는 것이 목표 — 다만 후보자에게도 최소한의 선택권은 남긴다).
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

  const recommendations = recommendLeastConflictSlots(
    (panelInterviewers ?? []) as Interviewer[],
    (rooms ?? []) as Room[],
    needsRoom,
    5,
    interview.excluded_slots ?? [],
    interviewDurationMinutes(interview.interview_type),
  );
  if (!recommendations.length) {
    return { ok: false, error: "추천할 수 있는 시간대가 없습니다." };
  }
  // 동점 후보들은 충돌 수가 모두 같으므로 첫 번째만 봐도 전체 상황을 알 수 있다.
  const hasConflict = recommendations[0].conflicts.length > 0;

  const token = generateToken();
  const { error: insErr } = await supabase.from("response_requests").insert({
    token,
    kind: "candidate",
    interview_id: interview.id,
  });
  if (insErr) return { ok: false, error: insErr.message };

  const link = `${origin}/respond/${token}`;
  const whenList = recommendations.map((r) => formatSlotLabel(r.slot));
  const isSingle = whenList.length === 1;
  // 후보자에게 이메일 본문에서 전체 시간 목록을 죽 나열하지 않는다 — 링크를 열면
  // 어차피 같은 목록을 날짜별로 훨씬 보기 좋게 보여준다. 시간이 하나뿐일 때만
  // 클릭 전에 바로 알 수 있게 본문에 간단히 언급한다.
  try {
    await sendEmail(
      interview.candidate_email,
      `[인터뷰싱크] ${interview.position} 면접 일정을 제안드립니다`,
      `
        <p>안녕하세요, ${interview.candidate_name}님.</p>
        <p><b>${interview.position}</b> 면접(${interview.interview_type}) ${
          isSingle
            ? `일정을 <b>${whenList[0]}</b>로 제안드립니다.`
            : "가능한 시간을 안내드립니다."
        }</p>
        <p>아래 링크에서 ${isSingle ? "확인 후 확정해주세요." : "편한 시간을 선택해 확정해주세요."}</p>
        <p><a href="${link}">${link}</a></p>
      `,
    );
  } catch (e) {
    // 메일이 실제로 안 나갔는데 stage를 candidate_pending으로 넘기면 "후보자 응답
    // 대기 중"이라고 잘못 표시된다 — 그러니 stage는 건드리지 않고 실패만 남긴다.
    const reason = emailErrorReason(e);
    await supabase
      .from("interviews")
      .update({
        note: `⚠️ 후보자 초대 메일 발송 실패(${interview.candidate_email}, 사유: ${reason}) — 상세보기에서 "후보자에게 이메일 발송" 버튼을 다시 눌러주세요`,
      })
      .eq("id", interview.id);
    return { ok: false, error: `후보자에게 메일 발송에 실패했습니다(${reason}).` };
  }

  // 제안 시점의 시간들을 고정해서 저장해둔다. 후보자가 링크를 다시 열어봐도(면접관
  // 가용 시간이 그 사이 바뀌었더라도) 처음 안내받은 시간과 동일한 목록을 보게 하기 위함.
  await supabase.from("response_requests").update({ email_sent_at: new Date().toISOString() }).eq("token", token);
  await supabase
    .from("interviews")
    .update({
      stage: "candidate_pending",
      recommended_slots: recommendations.map((r) => r.slot),
      note: hasConflict
        ? `면접관 전원 동시 가능 시간 없음 — 충돌 최소 시간으로 임시 제안함 (겹침: ${recommendations[0].conflicts.join(", ")})`
        : null,
    })
    .eq("id", interview.id);

  return { ok: true };
}
