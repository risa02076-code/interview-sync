import { SupabaseClient } from "@supabase/supabase-js";
import { matchAndPersist } from "./applyMatch";
import { ConfirmConflictError } from "./confirmInterview";
import { emailErrorReason } from "./email";

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
 *
 * 이 함수는 면접관이 마지막 응답을 제출하는 순간 자동으로 트리거된다 — 리크루터가
 * 아니라 면접관이 이 실패를 마주치게 된다는 뜻이다. 그래서 저장 중 에러가 나도
 * 밖으로 던지지 않는다(응답 제출 자체는 이미 성공했으니 면접관에게는 정상 응답을
 * 돌려줘야 한다). 대신 실패를 note에 남겨 리크루터가 대시보드에서 볼 수 있게 한다.
 */
export async function confirmFromPriorities(supabase: SupabaseClient, interview: Interview): Promise<boolean> {
  for (const slot of interview.preferred_slots) {
    let result;
    try {
      result = await matchAndPersist(supabase, interview.id, [slot], interview.panel, interview.interview_type);
    } catch (e) {
      if (e instanceof ConfirmConflictError) {
        // 이 순간 다른 확정과 겹쳐 막힌 것뿐이다 — 다음 순위로 계속 시도한다.
        continue;
      }
      // 저장 자체가 실패한 경우(마이그레이션 누락 등)는 다음 순위를 시도해도 똑같이
      // 실패할 뿐이니, 반복하지 않고 바로 리크루터에게 알린다.
      console.error(`[confirm-failed] interview=${interview.id}, slot=${slot}, error=${emailErrorReason(e)}`);
      await supabase
        .from("interviews")
        .update({
          note: `⚠️ 면접관 전원 확인 후 자동 확정을 시도했지만 저장에 실패했습니다(사유: ${emailErrorReason(e)}) — 상세보기에서 직접 확정해주세요`,
        })
        .eq("id", interview.id);
      return false;
    }
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
