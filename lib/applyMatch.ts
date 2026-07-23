import { SupabaseClient } from "@supabase/supabase-js";
import { findMatch, requiresRoom, type Interviewer, type Room } from "./matching";

/**
 * 후보자가 응답 링크로 희망시간을 처음 제출했을 때 사용.
 * (재조율의 "전체 슬롯 재탐색"과는 다르게, 여기서는 후보자가 지금 막 제출한
 *  슬롯 안에서만 매칭을 시도한다 — broaden=false)
 */
export async function matchAndPersist(
  supabase: SupabaseClient,
  interviewId: string,
  candidateSlots: string[],
  panel: string[],
  interviewType: string,
) {
  const { data: panelInterviewers } = await supabase.from("interviewers").select("*").in("id", panel);
  const { data: rooms } = await supabase.from("rooms").select("*");

  const result = findMatch(
    candidateSlots,
    panelInterviewers as Interviewer[],
    rooms as Room[],
    false,
    requiresRoom(interviewType),
  );

  const { data: updated, error } = await supabase
    .from("interviews")
    .update({
      preferred_slots: candidateSlots,
      matched_slot: result.matchedSlot,
      room_id: result.roomId,
      status: result.status,
      note: result.note,
    })
    .eq("id", interviewId)
    .select()
    .single();
  if (error) throw error;

  if (result.status === "confirmed" && result.matchedSlot !== null) {
    for (const p of panelInterviewers as Interviewer[]) {
      await supabase
        .from("interviewers")
        .update({ busy_slots: [...p.busy_slots, result.matchedSlot] })
        .eq("id", p.id);
    }
    const room = (rooms as Room[]).find((r) => r.id === result.roomId);
    if (room) {
      await supabase
        .from("rooms")
        .update({ busy_slots: [...room.busy_slots, result.matchedSlot] })
        .eq("id", room.id);
    }
  }

  return updated;
}
