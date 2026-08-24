import { describe, it, expect } from "vitest";
import { matchAndPersist } from "./applyMatch";
import type { SupabaseClient } from "@supabase/supabase-js";

const TEN = "2024-01-02T01:00:00.000Z"; // 10:00 KST
const TEN_30 = "2024-01-02T01:30:00.000Z"; // 10:30 KST

/**
 * matchAndPersist가 실제로 두는 호출만 지원하는 최소 가짜 클라이언트.
 * rpc 호출과 update 호출을 각각 따로 기록해서, 확정일 때와 아닐 때 어느 경로로
 * 갔는지 구분할 수 있게 한다.
 */
function fakeSupabase({
  interviewers = [] as Record<string, unknown>[],
  rooms = [] as Record<string, unknown>[],
} = {}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const updateCalls: { table: string; payload: Record<string, unknown> }[] = [];

  const selectResult = (name: string) => {
    const rows = name === "interviewers" ? interviewers : rooms;
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
        return {
          eq: () => ({
            select: () => ({ single: async () => ({ data: { id: "iv-1", ...payload }, error: null }) }),
          }),
        };
      },
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      rpcCalls.push({ fn, args });
      return { data: { id: "iv-1", matched_slot: args.p_slot }, error: null };
    },
  } as unknown as SupabaseClient;

  return { client, rpcCalls, updateCalls };
}

const PANEL = ["p1", "p2"];
const freePanel = [
  { id: "p1", name: "배지훈", role: "디자이너", busy_slots: [] },
  { id: "p2", name: "오세훈", role: "리드", busy_slots: [] },
];
const freeRooms = [{ id: "r1", name: "면접실 A", busy_slots: [] }];

describe("matchAndPersist", () => {
  it("확정되면 나눠 쓰지 않고 confirm_interview 트랜잭션으로 저장한다", async () => {
    const { client, rpcCalls, updateCalls } = fakeSupabase({
      interviewers: freePanel,
      rooms: freeRooms,
    });

    await matchAndPersist(client, "iv-1", [TEN], PANEL, "1차 대면");

    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("confirm_interview");
    // 확정 경로에서는 개별 update가 하나도 나가지 않아야 한다 — 하나라도 나가면
    // 그만큼이 트랜잭션 밖에서 따로 커밋된다는 뜻이다.
    expect(updateCalls).toEqual([]);
  });

  it("1시간 면접은 시작 슬롯이 아니라 구간 전체를 점유로 넘긴다", async () => {
    const { client, rpcCalls } = fakeSupabase({ interviewers: freePanel, rooms: freeRooms });

    await matchAndPersist(client, "iv-1", [TEN], PANEL, "1차 대면");

    expect(rpcCalls[0].args.p_span).toEqual([TEN, TEN_30]);
  });

  it("30분 면접(온라인)은 한 칸만 점유하고 면접실 없이 확정한다", async () => {
    const { client, rpcCalls } = fakeSupabase({ interviewers: freePanel, rooms: freeRooms });

    await matchAndPersist(client, "iv-1", [TEN], PANEL, "온라인");

    expect(rpcCalls[0].args.p_span).toEqual([TEN]);
    expect(rpcCalls[0].args.p_room_id).toBeNull();
  });

  it("확정 경로는 겹침을 막는 쪽으로 부른다 (force를 켜지 않는다)", async () => {
    const { client, rpcCalls } = fakeSupabase({ interviewers: freePanel, rooms: freeRooms });

    await matchAndPersist(client, "iv-1", [TEN], PANEL, "1차 대면");

    expect(rpcCalls[0].args.p_force).toBe(false);
  });

  it("후보자 희망시간을 함께 저장한다", async () => {
    const { client, rpcCalls } = fakeSupabase({ interviewers: freePanel, rooms: freeRooms });

    await matchAndPersist(client, "iv-1", [TEN], PANEL, "1차 대면");

    expect(rpcCalls[0].args.p_preferred_slots).toEqual([TEN]);
  });

  it("확정이 아니면 바뀌는 곳이 한 곳뿐이라 트랜잭션 없이 그대로 저장한다", async () => {
    const { client, rpcCalls, updateCalls } = fakeSupabase({
      interviewers: freePanel,
      rooms: freeRooms,
    });

    // 희망시간이 비어 있으면 findMatch가 pending을 돌려준다
    const result = await matchAndPersist(client, "iv-1", [], PANEL, "1차 대면");

    expect(rpcCalls).toEqual([]);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].table).toBe("interviews");
    expect(updateCalls[0].payload.status).toBe("pending");
    expect((result as { id: string }).id).toBe("iv-1");
  });

  it("패널이 그 시간에 이미 차 있으면 확정하지 않으므로 트랜잭션도 열지 않는다", async () => {
    const { client, rpcCalls, updateCalls } = fakeSupabase({
      interviewers: [{ ...freePanel[0], busy_slots: [TEN] }, freePanel[1]],
      rooms: freeRooms,
    });

    await matchAndPersist(client, "iv-1", [TEN], PANEL, "1차 대면");

    expect(rpcCalls).toEqual([]);
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0].payload.status).not.toBe("confirmed");
  });
});
