import { SupabaseClient } from "@supabase/supabase-js";
import { generateToken } from "./token";
import { sendEmail } from "./email";
import { generateUpcomingSlots } from "./slots";
import { requiresRoom } from "./matching";

type Interview = {
  id: string;
  candidate_name: string;
  candidate_email: string | null;
  position: string;
  panel: string[];
  interview_type: string;
};

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
    .select("busy_slots")
    .in("id", interview.panel);
  const { data: rooms } = needsRoom ? await supabase.from("rooms").select("busy_slots") : { data: null };

  const viableSlots = generateUpcomingSlots().filter((s) => {
    const panelBusy = panelInterviewers?.some((p) => p.busy_slots.includes(s.key));
    if (panelBusy) return false;
    if (needsRoom && !rooms?.some((r) => !r.busy_slots.includes(s.key))) return false;
    return true;
  });
  if (!viableSlots.length) {
    return { ok: false, error: "면접관 전원이 가능한 시간대가 현재 없습니다. 패널 구성을 조정해주세요." };
  }

  const token = generateToken();
  const { error: insErr } = await supabase.from("response_requests").insert({
    token,
    kind: "candidate",
    interview_id: interview.id,
  });
  if (insErr) return { ok: false, error: insErr.message };

  const link = `${origin}/respond/${token}`;
  await sendEmail(
    interview.candidate_email,
    `[인터뷰싱크] ${interview.position} 면접 가능 시간을 알려주세요`,
    `
      <p>안녕하세요, ${interview.candidate_name}님.</p>
      <p><b>${interview.position}</b> 면접(${interview.interview_type})을 위해 가능한 시간대를 선택해주세요.</p>
      <p><a href="${link}">${link}</a></p>
      <p style="color:#888;font-size:12px">선택 가능한 시간대: ${viableSlots.map((s) => s.label).join(", ")}</p>
    `,
  );

  await supabase.from("interviews").update({ stage: "candidate_pending" }).eq("id", interview.id);

  return { ok: true };
}
