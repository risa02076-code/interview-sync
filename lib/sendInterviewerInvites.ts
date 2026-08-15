import { SupabaseClient } from "@supabase/supabase-js";
import { generateToken } from "./token";
import { sendEmail } from "./email";

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

  // 한 명 발송에 실패해도 나머지는 계속 보낸다 — 실패한 사람만 note에 남겨서
  // 리크루터가 면접관 관리 페이지에서 그 사람에게만 다시 보낼 수 있게 한다.
  const failed: string[] = [];
  for (const interviewer of panelInterviewers) {
    const token = generateToken();
    await supabase.from("response_requests").insert({
      token,
      kind: "interviewer",
      interview_id: interview.id,
      interviewer_id: interviewer.id,
    });

    const link = `${origin}/respond/${token}`;
    try {
      await sendEmail(
        interviewer.email,
        `[인터뷰싱크] ${interview.candidate_name}(${interview.position}) 면접 - 불가능한 시간을 알려주세요`,
        `
          <p>안녕하세요, ${interviewer.name}님.</p>
          <p><b>${interview.candidate_name}</b>님(${interview.position}) 면접 관련해서 연락드립니다.</p>
          <p>아래 링크의 30분 단위 캘린더에서 <b>불가능한</b> 시간을 모두 선택해주세요.</p>
          <p><a href="${link}">${link}</a></p>
        `,
      );
    } catch {
      failed.push(interviewer.name);
    }
  }

  await supabase
    .from("interviews")
    .update({
      stage: "interviewer_pending",
      ...(failed.length
        ? { note: `⚠️ 면접관 초대 메일 발송 실패: ${failed.join(", ")} — 면접관 관리 페이지에서 다시 보내주세요` }
        : {}),
    })
    .eq("id", interview.id);

  if (failed.length) {
    return { ok: false, error: `다음 면접관에게 메일 발송 실패: ${failed.join(", ")}` };
  }
  return { ok: true, sent: panelInterviewers.length };
}
