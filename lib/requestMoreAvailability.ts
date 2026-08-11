import { SupabaseClient } from "@supabase/supabase-js";
import { generateToken } from "./token";
import { sendEmail } from "./email";

type Interview = { id: string; candidate_name: string; position: string; panel: string[] };

/** 재문의당 조회 기간을 며칠씩(영업일) 넓힐지 */
export const AVAILABILITY_ROUND_BUSINESS_DAYS = 5;
/** 이 라운드까지 넓혀보고도 공통 시간이 없으면 자동화를 멈추고 리크루터에게 넘긴다 */
export const MAX_AVAILABILITY_ROUNDS = 3;

/**
 * 면접관 전원이 응답했는데도 동시에 가능한 시간이 하나도 없을 때 호출한다.
 * 조회 기간을 넓혀(라운드당 5영업일 추가) 전원에게 새 토큰으로 다시 문의하고,
 * 응답 대기 상태로 되돌린다 — 후보자에게는 절대 안내하지 않는다.
 */
export async function requestMoreAvailability(
  supabase: SupabaseClient,
  interview: Interview,
  origin: string,
  round: number,
): Promise<{ ok: true; sent: number } | { ok: false; error: string }> {
  const { data: panelInterviewers, error } = await supabase
    .from("interviewers")
    .select("*")
    .in("id", interview.panel);
  if (error) return { ok: false, error: error.message };

  const businessDays = round * AVAILABILITY_ROUND_BUSINESS_DAYS;

  for (const interviewer of panelInterviewers) {
    if (!interviewer.email) continue;
    const token = generateToken();
    await supabase.from("response_requests").insert({
      token,
      kind: "interviewer",
      interview_id: interview.id,
      interviewer_id: interviewer.id,
    });

    const link = `${origin}/respond/${token}`;
    await sendEmail(
      interviewer.email,
      `[인터뷰싱크] ${interview.candidate_name}(${interview.position}) 면접 - 조회 기간을 넓혀 다시 확인해주세요`,
      `
        <p>안녕하세요, ${interviewer.name}님.</p>
        <p><b>${interview.candidate_name}</b>님(${interview.position}) 면접 관련해서, 지금까지 확인한 기간
        안에는 패널 전원이 동시에 가능한 시간이 없었습니다. 기간을 <b>영업일 ${businessDays}일</b>로 넓혀서
        다시 여쭤봅니다. 이전에 표시하신 시간은 아래 캘린더에 그대로 남아있으니, 새로 늘어난 기간만
        추가로 확인해 <b>불가능한</b> 시간을 선택해주세요.</p>
        <p><a href="${link}">${link}</a></p>
      `,
    );
  }

  await supabase
    .from("interviews")
    .update({
      stage: "interviewer_pending",
      availability_round: round,
      note: `면접관 전원 동시 가능 시간 없음 — 조회 기간을 영업일 ${businessDays}일로 넓혀 재문의함 (${round}차)`,
    })
    .eq("id", interview.id);

  return { ok: true, sent: panelInterviewers.filter((p) => p.email).length };
}
