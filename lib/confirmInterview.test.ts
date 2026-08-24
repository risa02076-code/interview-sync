import { describe, it, expect } from "vitest";
import {
  confirmInterviewAtomically,
  ConfirmConflictError,
  CONFIRM_CONFLICT_CODE,
} from "./confirmInterview";
import type { SupabaseClient } from "@supabase/supabase-js";

const SLOT = "2024-01-02T01:00:00.000Z";
const SPAN = [SLOT, "2024-01-02T01:30:00.000Z"];

/** rpc 한 번만 지원하는 최소 가짜 클라이언트. 호출 인자를 그대로 기록한다. */
function fakeSupabase(result: { data?: unknown; error?: { code?: string; message: string } }) {
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  const client = {
    rpc: async (fn: string, args: Record<string, unknown>) => {
      calls.push({ fn, args });
      return { data: result.data ?? null, error: result.error ?? null };
    },
  } as unknown as SupabaseClient;
  return { client, calls };
}

const base = {
  interviewId: "iv-1",
  slot: SLOT,
  span: SPAN,
  roomId: "room-1",
  status: "confirmed",
  note: "자동 확정",
};

describe("confirmInterviewAtomically", () => {
  it("세 번의 쓰기를 나누지 않고 confirm_interview rpc 한 번으로 부른다", async () => {
    const { client, calls } = fakeSupabase({ data: { id: "iv-1" } });
    await confirmInterviewAtomically(client, base);

    expect(calls).toHaveLength(1);
    expect(calls[0].fn).toBe("confirm_interview");
  });

  it("점유 구간을 그대로 넘긴다 (시작 슬롯 하나가 아니라 구간 전체)", async () => {
    const { client, calls } = fakeSupabase({ data: {} });
    await confirmInterviewAtomically(client, base);

    expect(calls[0].args.p_slot).toBe(SLOT);
    expect(calls[0].args.p_span).toEqual(SPAN);
  });

  it("선택 인자를 안 주면 '기존 값 유지'(null)와 '막는다'(force=false)가 기본이다", async () => {
    const { client, calls } = fakeSupabase({ data: {} });
    await confirmInterviewAtomically(client, base);

    expect(calls[0].args.p_stage).toBeNull();
    expect(calls[0].args.p_preferred_slots).toBeNull();
    expect(calls[0].args.p_reset_confirmation).toBe(false);
    expect(calls[0].args.p_force).toBe(false);
  });

  it("수동 확정처럼 겹쳐도 진행해야 하는 경우 force를 그대로 전달한다", async () => {
    const { client, calls } = fakeSupabase({ data: {} });
    await confirmInterviewAtomically(client, {
      ...base,
      stage: "candidate_done",
      resetConfirmation: true,
      force: true,
    });

    expect(calls[0].args.p_force).toBe(true);
    expect(calls[0].args.p_stage).toBe("candidate_done");
    expect(calls[0].args.p_reset_confirmation).toBe(true);
  });

  it("겹침으로 거부되면(PT409) ConfirmConflictError로 구분해서 던진다", async () => {
    const { client } = fakeSupabase({
      error: { code: CONFIRM_CONFLICT_CODE, message: "이미 다른 일정이 잡혀 있는 면접관: 배지훈" },
    });

    await expect(confirmInterviewAtomically(client, base)).rejects.toBeInstanceOf(
      ConfirmConflictError,
    );
  });

  it("겹침이 아닌 실패(함수 없음 등)는 조용히 넘어가지 않고 그대로 던진다", async () => {
    // 마이그레이션을 아직 실행하지 않은 DB가 이 경우다. 옛 방식으로 되돌아가면
    // 안전장치가 꺼진 채로 정상 동작하는 것처럼 보이므로 반드시 실패해야 한다.
    const { client } = fakeSupabase({
      error: { code: "PGRST202", message: "function confirm_interview does not exist" },
    });

    const thrown = await confirmInterviewAtomically(client, base).catch((e) => e);
    expect(thrown).toBeInstanceOf(Error);
    expect(thrown).not.toBeInstanceOf(ConfirmConflictError);
    expect((thrown as Error).message).toContain("확정 저장 실패");
    expect((thrown as Error).message).toContain("does not exist");
  });

  it("성공하면 DB 함수가 돌려준 면접 행을 그대로 반환한다", async () => {
    const row = { id: "iv-1", matched_slot: SLOT, status: "confirmed" };
    const { client } = fakeSupabase({ data: row });

    expect(await confirmInterviewAtomically(client, base)).toEqual(row);
  });
});
