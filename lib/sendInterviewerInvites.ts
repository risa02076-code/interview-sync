import { SupabaseClient } from "@supabase/supabase-js";
import { generateToken } from "./token";
import { sendEmail } from "./email";
import { generateUpcomingSlots } from "./slots";

type Interview = { id: string; candidate_name: string; position: string; panel: string[] };

export async function sendInterviewerInvites(
  supabase: SupabaseClient,
  interview: Interview,
  origin: string,
): Promise<{ ok: true; sent: number } | { ok: false; error: string }> {
  const { data: panelInterviewers, error } = await supabase
    .from("interviewers")
    .select("*")
    .in("id", interview.panel);
  if (error) return { ok: false, error: error.message };

  const missingEmail = panelInterviewers.filter((p) => !p.email);
  if (missingEmail.length) {
    return {
      ok: false,
      error: `${missingEmail.map((p) => p.name).join(", ")} 면접관의 이메일이 등록되어 있지 않습니다.`,
    };
  }

  for (const interviewer of panelInterviewers) {
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
      `[인터뷰싱크] ${interview.candidate_name}(${interview.position}) 면접 - 불가능한 시간을 알려주세요`,
      `
        <p>안녕하세요, ${interviewer.name}님.</p>
        <p><b>${interview.candidate_name}</b>님(${interview.position}) 면접 관련해서, 아래 시간대 중 <b>불가능한</b> 시간을 모두 선택해주세요.</p>
        <p><a href="${link}">${link}</a></p>
        <p style="color:#888;font-size:12px">전체 시간대: ${generateUpcomingSlots().map((s) => s.label).join(", ")}</p>
      `,
    );
  }

  await supabase.from("interviews").update({ stage: "interviewer_pending" }).eq("id", interview.id);

  return { ok: true, sent: panelInterviewers.length };
}
