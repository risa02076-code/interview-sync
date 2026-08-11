import { SupabaseClient } from "@supabase/supabase-js";
import { matchAndPersist } from "./applyMatch";
import { sendConfirmationEmail } from "./sendConfirmationEmail";

type Interview = {
  id: string;
  panel: string[];
  interview_type: string;
  preferred_slots: string[];
};

/**
 * 면접관 전원이 우선순위 확인 요청에 응답을 마쳤을 때 호출한다. 순위가 높은
 * 시간부터(preferred_slots 순서대로) 실제로 지금도 비어있는지 다시 검증하며,
 * 전원 가능한 첫 번째 시간으로 자동 확정한다. 응답하는 동안 busy_slots가 이미
 * 최신 상태로 갱신돼 있으므로, matchAndPersist의 실검증이 곧 "전원 가능 여부" 확인이 된다.
 */
export async function confirmFromPriorities(
  supabase: SupabaseClient,
  interview: Interview,
  origin: string,
): Promise<boolean> {
  for (const slot of interview.preferred_slots) {
    const result = await matchAndPersist(supabase, interview.id, [slot], interview.panel, interview.interview_type);
    if (result?.status === "confirmed") {
      await sendConfirmationEmail(supabase, result, origin);
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
