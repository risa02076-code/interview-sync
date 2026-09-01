import { describe, it, expect } from "vitest";
import { confirmFromPriorities } from "./confirmFromPriorities";
import { CONFIRM_CONFLICT_CODE } from "./confirmInterview";
import type { SupabaseClient } from "@supabase/supabase-js";

const TEN = "2024-01-02T01:00:00.000Z"; // 10:00 KST
const TEN_30 = "2024-01-02T01:30:00.000Z"; // 10:30 KST

const PANEL = ["p1", "p2"];
const freePanel = [
  { id: "p1", name: "배지훈", role: "디자이너", busy_slots: [] },
  { id: "p2", name: "오세훈", role: "리드", busy_slots: [] },
];
const freeRooms = [{ id: "r1", name: "면접실 A", busy_slots: [] }];

/**
 * confirmFromPriorities가 실제로 두는 호출(면접관·면접실 조회, confirm_interview
 * rpc, 실패 시 interviews.note 갱신)만 지원하는 최소 가짜 클라이언트. rpc 결과를
 * 호출 순서대로 미리 정해둘 수 있어서, "첫 순위는 막히고 두 번째 순위는 된다" 같은
 * 시나리오를 재현할 수 있다.
 */
function fakeSupabase(rpcResults: Array<{ data?: unknown; error?: { code?: string; message: string } }>) {
  let rpcCallCount = 0;
  const updateCalls: { table: string; payload: Record<string, unknown> }[] = [];

  const selectResult = (name: string) => {
    const rows = name === "interviewers" ? freePanel : freeRooms;
    return {
      in: async () => ({ data: rows }),
      // rooms는 .in() 없이 select 자체를 await한다
      then: (resolve: (v: { data: unknown }) => void) => resolve({ data: rows }),
    };
  };

  const client = {
    from: (name: string) => ({
      select: () => selectResult(name),
      update(payload: Record<string, unknown>) {
        updateCalls.push({ table: name, payload });
        return { eq: async () => ({ data: null, error: null }) };
      },
    }),
    rpc: async () => {
      const result = rpcResults[Math.min(rpcCallCount, rpcResults.length - 1)];
      rpcCallCount++;
      return { data: result.data ?? null, error: result.error ?? null };
    },
  } as unknown as SupabaseClient;

  return { client, updateCalls, rpcCallCount: () => rpcCallCount };
}

const baseInterview = { id: "iv-1", panel: PANEL, interview_type: "1차 대면" };

describe("confirmFromPriorities", () => {
  it("첫 순위가 그대로 확정되면 note를 건드리지 않는다", async () => {
    const { client, updateCalls, rpcCallCount } = fakeSupabase([
      { data: { id: "iv-1", status: "confirmed", matched_slot: TEN } },
    ]);

    const ok = await confirmFromPriorities(client, { ...baseInterview, preferred_slots: [TEN] });

    expect(ok).toBe(true);
    expect(rpcCallCount()).toBe(1);
    expect(updateCalls).toEqual([]);
  });

  it("이 순간 다른 확정과 겹쳐(PT409) 막히면 다음 순위로 계속 시도한다", async () => {
    const { client, updateCalls, rpcCallCount } = fakeSupabase([
      { error: { code: CONFIRM_CONFLICT_CODE, message: "이미 다른 일정이 잡혀 있는 면접관: 배지훈" } },
      { data: { id: "iv-1", status: "confirmed", matched_slot: TEN_30 } },
    ]);

    const ok = await confirmFromPriorities(client, {
      ...baseInterview,
      preferred_slots: [TEN, TEN_30],
    });

    expect(ok).toBe(true);
    expect(rpcCallCount()).toBe(2);
    // 겹침 재시도는 정상 흐름이니 리크루터에게 알릴 일이 아니다.
    expect(updateCalls).toEqual([]);
  });

  it("저장 자체가 실패하면(마이그레이션 누락 등) 재시도하지 않고 note에 사유를 남긴다", async () => {
    // 이 실패는 어느 순위를 시도해도 똑같이 나므로, 나머지 순위를 반복하지 않는다.
    const { client, updateCalls, rpcCallCount } = fakeSupabase([
      { error: { code: "PGRST202", message: "function confirm_interview does not exist" } },
    ]);

    const ok = await confirmFromPriorities(client, {
      ...baseInterview,
      preferred_slots: [TEN, TEN_30],
    });

    expect(ok).toBe(false);
    expect(rpcCallCount()).toBe(1);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe("interviews");
    expect(updateCalls[0].payload.note).toContain("⚠️");
    expect(updateCalls[0].payload.note).toContain("does not exist");
    // 아직 다른 순위로 리크루터가 직접 확정할 여지가 있으니 status는 건드리지 않는다.
    expect(updateCalls[0].payload).not.toHaveProperty("status");
  });
});
