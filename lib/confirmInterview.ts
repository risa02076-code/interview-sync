import { SupabaseClient } from "@supabase/supabase-js";

/**
 * 확정을 하나의 트랜잭션으로 묶어 저장하는 경로.
 *
 * 확정 한 건은 저장이 세 군데로 나뉜다 — 면접 행, 면접관별 busy_slots, 회의실
 * busy_slots. supabase-js는 여러 요청을 한 트랜잭션으로 묶지 못하므로(요청 하나가
 * 곧 트랜잭션 하나다), 그냥 나눠 쓰면 중간에 하나가 실패했을 때 "확정됐다고 적혀
 * 있는데 캘린더는 비어 있는" 반쪽 상태가 남고, 두 요청이 같은 순간에 같은 시간을
 * 확정하면 둘 다 통과한다.
 *
 * 그래서 세 번의 쓰기를 DB 함수 confirm_interview 안으로 옮기고 여기서 rpc로 한 번만
 * 부른다(supabase/migration_confirm_transaction.sql). 함수 호출 하나가 곧 트랜잭션
 * 하나라 전부 되거나 전부 안 되고, 함수 안에서 잠금을 잡고 다시 확인하므로 동시
 * 확정도 막힌다.
 *
 * 판단 로직은 여기 오지 않는다 — 어느 시간이 가능한지(lib/matching.ts), 그 면접이
 * 몇 칸을 차지하는지(lib/slots.ts의 occupiedSlots)는 그대로 TypeScript에 남아
 * 테스트로 검증된다. 이 모듈과 DB 함수는 "이미 정해진 결정을 안전하게 저장"만 한다.
 */

/**
 * 잠금을 잡고 다시 확인한 결과 이미 다른 일정이 있어 거부된 경우의 SQLSTATE.
 * PostgREST의 PT 접두사 규칙이라 HTTP 409로 나가고 supabase-js의 error.code에
 * 그대로 담긴다 — 실패 문구를 비교하지 않고 코드로 분기하기 위한 것이다.
 */
export const CONFIRM_CONFLICT_CODE = "PT409";

/** 겹침 때문에 확정이 거부된 경우. "저장이 깨진 것"이 아니라 "막힌 것"이다. */
export class ConfirmConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfirmConflictError";
  }
}

export type ConfirmInterviewArgs = {
  interviewId: string;
  /** 확정할 시작 시간(슬롯 키) */
  slot: string;
  /** 그 면접이 실제로 차지하는 슬롯 전체. 호출하는 쪽이 occupiedSlots로 계산해 넘긴다. */
  span: string[];
  roomId: string | null;
  status: string;
  note: string | null;
  /** null이면 기존 stage를 그대로 둔다 */
  stage?: string | null;
  /** null이면 기존 preferred_slots를 그대로 둔다 */
  preferredSlots?: string[] | null;
  /** 확정 시간이 바뀌었으니 "확정 메일 보냄" 표시를 지워야 하는 경우 */
  resetConfirmation?: boolean;
  /**
   * true면 겹쳐도 그대로 확정한다. 리크루터의 수동 확정이 이 경우다 — 그 API를
   * 호출한다는 것 자체가 충돌을 감안한 사람의 결정이라 막지 않는다(원자성은 그대로 얻는다).
   */
  force?: boolean;
};

export async function confirmInterviewAtomically(
  supabase: SupabaseClient,
  args: ConfirmInterviewArgs,
) {
  const { data, error } = await supabase.rpc("confirm_interview", {
    p_interview_id: args.interviewId,
    p_slot: args.slot,
    p_span: args.span,
    p_room_id: args.roomId,
    p_status: args.status,
    p_note: args.note,
    p_stage: args.stage ?? null,
    p_preferred_slots: args.preferredSlots ?? null,
    p_reset_confirmation: args.resetConfirmation ?? false,
    p_force: args.force ?? false,
  });

  if (error) {
    if (error.code === CONFIRM_CONFLICT_CODE) {
      throw new ConfirmConflictError(error.message);
    }
    // 함수가 없으면(마이그레이션 미실행) 여기로 온다. 조용히 옛 방식으로 되돌아가지
    // 않는다 — 되돌아가면 안전장치가 꺼진 채로 정상 동작하는 것처럼 보인다.
    throw new Error(`확정 저장 실패: ${error.message}`);
  }
  return data;
}
