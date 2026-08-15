import { SupabaseClient } from "@supabase/supabase-js";
import { matchAndPersist } from "./applyMatch";

type Interview = {
  id: string;
  panel: string[];
  interview_type: string;
  preferred_slots: string[];
};

/**
 * 면접관 전원이 우선순위 확인 요청에 응답을 마쳤을 때 호출한다. 순위가 높은
 * 시간부터(preferred_slots 순서대로) 실제로 지금도 비어있는지 다시 검증하며,
 * 전원 가능한 첫 번째 시간으로 매칭을 확정한다.
 *
 * 확정 메일은 여기서 자동으로 보내지 않는다 — "조율 완료" 상태로만 남겨두고,
 * 리크루터가 상세 페이지에서 "확정 메일 발송" 버튼을 직접 눌러야 실제로 후보자·
 * 면접관에게 메일이 나간다. 다른 확정 경로(수동 확정)와 동일하게, 가장 위험한
 * 메일(최종 확정)은 항상 사람이 한 번 확인한 뒤에만 발송되도록 통일한 것이다.
 */
export async function confirmFromPriorities(supabase: SupabaseClient, interview: Interview): Promise<boolean> {
  for (const slot of interview.preferred_slots) {
    const result = await matchAndPersist(supabase, interview.id, [slot], interview.panel, interview.interview_type);
    if (result?.status === "confirmed") {
      return true;
    }
  }

  await supabase
    .from("interviews")
    .update({
      status: "escalated",
      note: "면접관 확인 결과 후보자가 제출한 순위 중 전원 가능한 시간이 없음 — 리크루터 확인 필요",
    })
    .eq("id", interview.id);
  return false;
}
