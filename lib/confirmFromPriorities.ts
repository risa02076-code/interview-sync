import { SupabaseClient } from "@supabase/supabase-js";
import { findMatch, requiresRoom, type Interviewer } from "./matching";
import type { ManagedRoom } from "./rooms";
import { findNoRestBefore } from "./backToBack";
import { confirmInterviewAtomically, ConfirmConflictError } from "./confirmInterview";
import { interviewDurationMinutes, occupiedSlots, formatSlotLabel } from "./slots";
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
 * 전원 가능한 시간으로 매칭을 확정한다.
 *
 * 다만 "전원 가능"이라는 답변은 그 시간 하나만 보고 한 답이라, 면접관이 직전
 * 면접과 쉬는 시간 없이 이어지는지는 스스로 따지지 않는다(lib/backToBack.ts).
 * 그래서 가장 높은 순위가 전원 가능하더라도 그 시간에 쉬는 시간 없음 경고가
 * 있고, 경고 없는 더 낮은 순위가 있으면 그쪽을 먼저 시도한다 — 후보자가 낸
 * 순위 자체를 어기는 게 아니라, "전원 가능"이라는 조건을 만족하는 여러 시간
 * 중 더 나은 쪽을 고르는 것뿐이다. 어느 시간으로 확정되든, 경고가 남아있으면
 * 리크루터가 발송 직전 화면에서 보게 된다(app/interviews/[id]/page.tsx).
 *
 * 이렇게 순위를 건너뛴 경우, 그 사실을 note에 남긴다 — 리크루터가 상세 화면에서
 * "후보자 1순위를 냈는데 왜 다른 시간으로 확정됐지?"라고 의아해하지 않도록, 왜
 * 건너뛰었는지(어느 면접관이 걸렸는지)를 그 자리에서 바로 알 수 있게 하기 위함이다.
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
  const { data: panelInterviewers } = await supabase
    .from("interviewers")
    .select("*")
    .in("id", interview.panel);
  const { data: rooms } = await supabase.from("rooms").select("*");

  const panel = (panelInterviewers ?? []) as Interviewer[];
  const roomList = (rooms ?? []) as ManagedRoom[];
  const durationMinutes = interviewDurationMinutes(interview.interview_type);
  const roomRequired = requiresRoom(interview.interview_type);

  // 순위마다 "지금도 전원 가능한가"만 먼저 계산한다(저장은 아직 안 함). findMatch는
  // 순수 함수라 여기서 여러 번 불러도 데이터를 건드리지 않는다. rank(0부터)는
  // 나중에 "몇 순위를 건너뛰었는지" 설명할 때 그대로 쓴다.
  const viable = interview.preferred_slots
    .map((slot, rank) => ({ rank, result: findMatch([slot], panel, roomList, false, roomRequired, durationMinutes) }))
    .filter((v) => v.result.status === "confirmed" && v.result.matchedSlot !== null)
    .map((v) => ({
      rank: v.rank,
      slot: v.result.matchedSlot as string,
      roomId: v.result.roomId,
      noRestNames: findNoRestBefore(panel, v.result.matchedSlot as string).map((p) => p.name),
    }));

  if (!viable.length) {
    await supabase
      .from("interviews")
      .update({
        status: "escalated",
        note: "면접관 확인 결과 후보자가 제출한 순위 중 전원 가능한 시간이 없음 — 리크루터 확인 필요",
      })
      .eq("id", interview.id);
    return false;
  }

  // 경고 없는 순위가 있으면 그걸 먼저 시도하고, 나머지는 원래 순위 순서 그대로
  // 뒤에 남겨둔다(그 경고 없는 시간마저 이 순간 다른 확정과 겹쳐 막히면 결국
  // 원래 순위대로 재시도해야 하기 때문).
  const preferred = viable.find((v) => !v.noRestNames.length) ?? viable[0];
  const skipped = preferred !== viable[0] ? viable[0] : null;
  const tryOrder = [preferred, ...viable.filter((v) => v !== preferred)];

  for (const candidate of tryOrder) {
    try {
      // preferred가 실제로 그대로 확정될 때만 "왜 순위를 건너뛰었는지" note를 남긴다.
      // preferred조차 이 순간 다른 확정과 겹쳐 막히면(드문 경우) 원래 순위대로
      // 재시도하는 것뿐이니, 그 케이스까지 설명을 붙이면 오히려 혼란스럽다.
      const note =
        candidate === preferred && skipped
          ? `ℹ️ 후보자 ${skipped.rank + 1}순위(${formatSlotLabel(skipped.slot)})는 ${skipped.noRestNames.join(", ")}이 직전 면접과 쉬는 시간 없이 이어져, 전원 가능한 ${preferred.rank + 1}순위(${formatSlotLabel(preferred.slot)})로 대신 확정했습니다.`
          : null;
      const result = await confirmInterviewAtomically(supabase, {
        interviewId: interview.id,
        slot: candidate.slot,
        span: occupiedSlots(candidate.slot, durationMinutes),
        roomId: candidate.roomId,
        status: "confirmed",
        note,
        preferredSlots: interview.preferred_slots,
      });
      if (result?.status === "confirmed") {
        return true;
      }
    } catch (e) {
      if (e instanceof ConfirmConflictError) {
        // 이 순간 다른 확정과 겹쳐 막힌 것뿐이다 — 다음 순위로 계속 시도한다.
        continue;
      }
      // 저장 자체가 실패한 경우(마이그레이션 누락 등)는 다음 순위를 시도해도 똑같이
      // 실패할 뿐이니, 반복하지 않고 바로 리크루터에게 알린다.
      console.error(`[confirm-failed] interview=${interview.id}, slot=${candidate.slot}, error=${emailErrorReason(e)}`);
      await supabase
        .from("interviews")
        .update({
          note: `⚠️ 면접관 전원 확인 후 자동 확정을 시도했지만 저장에 실패했습니다(사유: ${emailErrorReason(e)}) — 상세보기에서 직접 확정해주세요`,
        })
        .eq("id", interview.id);
      return false;
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
