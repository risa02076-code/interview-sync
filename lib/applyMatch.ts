import { SupabaseClient } from "@supabase/supabase-js";
import { findMatch, requiresRoom, type Interviewer, type Room } from "./matching";
import { confirmInterviewAtomically } from "./confirmInterview";
import { interviewDurationMinutes, occupiedSlots } from "./slots";

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

  const durationMinutes = interviewDurationMinutes(interviewType);

  const result = findMatch(
    candidateSlots,
    panelInterviewers as Interviewer[],
    rooms as Room[],
    false,
    requiresRoom(interviewType),
    durationMinutes,
  );

  if (result.status === "confirmed" && result.matchedSlot !== null) {
    // 확정은 면접 행 + 면접관별 busy_slots + 면접실을 함께 바꿔야 해서, 나눠 쓰면
    // 중간 실패 시 반쪽 상태가 남고 동시 확정도 둘 다 통과한다. DB 함수 한 번으로
    // 묶어 전부 되거나 전부 안 되게 하고, 그 안에서 잠근 뒤 다시 확인해 이중 배정을
    // 실제로 막는다(lib/confirmInterview.ts).
    //
    // 점유 구간은 여기서 계산해서 넘긴다 — 시작 슬롯 하나만 표시하면 바로 다음
    // 슬롯이 비어 있는 것으로 보여 겹치는 면접이 또 잡힌다. 소요시간 계산은 계속
    // TypeScript에 남겨 테스트가 검증하게 한다.
    return await confirmInterviewAtomically(supabase, {
      interviewId,
      slot: result.matchedSlot,
      span: occupiedSlots(result.matchedSlot, durationMinutes),
      roomId: result.roomId,
      status: result.status,
      note: result.note,
      preferredSlots: candidateSlots,
    });
  }

  // 확정이 아니면 바뀌는 곳이 면접 행 하나뿐이라 이미 원자적이다.
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

  return updated;
}
