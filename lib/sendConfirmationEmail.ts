import { SupabaseClient } from "@supabase/supabase-js";
import { sendEmail } from "./email";
import { formatSlotLabel } from "./slots";

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

export async function sendConfirmationEmail(
  supabase: SupabaseClient,
  interview: Interview,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!["confirmed", "rescheduled"].includes(interview.status) || !interview.matched_slot) {
    return { ok: false, error: "매칭이 완료된 케이스만 확정 메일을 보낼 수 있습니다." };
  }
  if (interview.confirmation_sent_at) {
    return { ok: false, error: "이미 확정 메일을 발송했습니다." };
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

  const when = formatSlotLabel(interview.matched_slot);
  const recipients = [
    interview.candidate_email,
    ...(panelInterviewers ?? []).map((p) => p.email),
  ].filter((e): e is string => !!e);

  if (!recipients.length) {
    return { ok: false, error: "발송할 이메일 주소가 없습니다." };
  }

  for (const to of recipients) {
    await sendEmail(
      to,
      `[인터뷰싱크] ${interview.candidate_name}(${interview.position}) 면접 일정이 확정되었습니다`,
      `
        <p><b>${interview.candidate_name}</b>님(${interview.position}) 면접 일정이 아래와 같이 확정되었습니다.</p>
        <p><b>${when}</b> · ${roomName}</p>
      `,
    );
  }

  await supabase
    .from("interviews")
    .update({ confirmation_sent_at: new Date().toISOString() })
    .eq("id", interview.id);

  return { ok: true };
}
