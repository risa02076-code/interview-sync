import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendPendingResponseReminders, sendDayBeforeReminders } from "./sendReminders";
import { sendEmail } from "./email";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("./email", () => ({
  sendEmail: vi.fn(),
  emailErrorReason: (e: unknown) => (e instanceof Error ? e.message : String(e)),
}));

type Row = Record<string, unknown>;
type UpdateCall = { table: string; id: string; payload: Row };

/**
 * sendReminders.ts가 실제로 쓰는 체이닝(select/eq/lt/in/not/is + update().eq())만
 * 지원하는 최소 가짜 클라이언트. 진짜 supabase-js 쿼리 빌더처럼 각 단계가 자기 자신을
 * 반환하다가 await되는 순간(.then)에 누적된 필터로 걸러낸 결과를 돌려준다.
 */
function fakeSupabase(tables: Record<string, Row[]>) {
  const updateCalls: UpdateCall[] = [];

  function makeChain(tableName: string, rows: Row[]) {
    const filters: [string, unknown][] = [];
    const chain = {
      select() {
        return chain;
      },
      eq(col: string, val: unknown) {
        filters.push([col, val]);
        return chain;
      },
      lt(col: string, val: unknown) {
        filters.push([`lt:${col}`, val]);
        return chain;
      },
      in(col: string, vals: unknown[]) {
        filters.push([`in:${col}`, vals]);
        return chain;
      },
      not(col: string) {
        filters.push([`not:${col}`, null]);
        return chain;
      },
      is(col: string, val: unknown) {
        filters.push([`is:${col}`, val]);
        return chain;
      },
      update(payload: Row) {
        return {
          eq: (_col: string, val: string) => {
            updateCalls.push({ table: tableName, id: val, payload });
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
      then(resolve: (v: { data: Row[]; error: null }) => void) {
        const filtered = rows.filter((r) =>
          filters.every(([key, val]) => {
            if (key.startsWith("lt:")) return (r[key.slice(3)] as number) < (val as number);
            if (key.startsWith("in:")) return (val as unknown[]).includes(r[key.slice(3)]);
            if (key.startsWith("not:")) return r[key.slice(4)] != null;
            if (key.startsWith("is:")) return val === null ? r[key.slice(3)] == null : r[key.slice(3)] === val;
            return r[key] === val;
          }),
        );
        resolve({ data: filtered, error: null });
      },
    };
    return chain;
  }

  return {
    client: {
      from: (name: string) => makeChain(name, tables[name] ?? []),
    } as unknown as SupabaseClient,
    updateCalls,
  };
}

const TWO_DAYS_AGO = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();

describe("sendPendingResponseReminders", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset();
  });

  const responseRequest = {
    id: "req-1",
    token: "tok-a",
    kind: "interviewer",
    status: "pending",
    reminder_count: 0,
    reminded_at: null,
    created_at: TWO_DAYS_AGO,
    interview_id: "iv-1",
    interviewer_id: "int-a",
  };
  const interview = {
    id: "iv-1",
    candidate_name: "이하은",
    candidate_email: "candidate@example.com",
    position: "디자이너",
  };
  const interviewer = { id: "int-a", name: "오세훈", email: "a@example.com" };

  it("발송에 실패하면 reminded_at은 그대로 두고(다음 크론에 재시도), 케이스 note에 사유를 남긴다", async () => {
    vi.mocked(sendEmail).mockRejectedValueOnce(new Error("SMTP 실패"));
    const { client, updateCalls } = fakeSupabase({
      response_requests: [responseRequest],
      interviews: [interview],
      interviewers: [interviewer],
    });

    const result = await sendPendingResponseReminders(client, "http://localhost:3000");

    expect(result.sent).toBe(0);
    expect(result.errors[0]).toContain("SMTP 실패");
    expect(updateCalls.some((c) => c.table === "response_requests")).toBe(false);
    const noteUpdate = updateCalls.find((c) => c.table === "interviews");
    expect(noteUpdate?.payload.note).toContain("오세훈");
    expect(noteUpdate?.payload.note).toContain("SMTP 실패");
    expect(noteUpdate?.payload.note).toContain("다음 리마인더");
  });

  it("발송에 성공하면 reminded_at/reminder_count/email_sent_at을 기록하고 note는 남기지 않는다", async () => {
    vi.mocked(sendEmail).mockResolvedValueOnce(undefined);
    const { client, updateCalls } = fakeSupabase({
      response_requests: [responseRequest],
      interviews: [interview],
      interviewers: [interviewer],
    });

    const result = await sendPendingResponseReminders(client, "http://localhost:3000");

    expect(result.sent).toBe(1);
    const reqUpdate = updateCalls.find((c) => c.table === "response_requests");
    expect(reqUpdate?.payload.reminder_count).toBe(1);
    expect(reqUpdate?.payload.email_sent_at).toBeDefined();
    expect(updateCalls.some((c) => c.table === "interviews")).toBe(false);
  });
});

describe("sendDayBeforeReminders", () => {
  beforeEach(() => {
    vi.mocked(sendEmail).mockReset();
  });

  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  const interview = {
    id: "iv-1",
    candidate_name: "이하은",
    candidate_email: "candidate@example.com",
    position: "디자이너",
    interview_type: "온라인",
    status: "confirmed",
    matched_slot: tomorrow,
    room_id: null,
    day_before_reminded_at: null,
    panel: ["a", "b"],
  };
  const interviewers = [
    { id: "a", name: "오세훈", email: "a@example.com" },
    { id: "b", name: "배지훈", email: "b@example.com" },
  ];

  it("일부 수신자만 실패해도 나머지에게는 계속 보내고, 실패자만 note에 남긴다", async () => {
    // 순서: candidate, 오세훈, 배지훈
    vi.mocked(sendEmail)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("SMTP 실패"))
      .mockResolvedValueOnce(undefined);
    const { client, updateCalls } = fakeSupabase({
      interviews: [interview],
      interviewers,
      rooms: [],
    });

    const result = await sendDayBeforeReminders(client);

    expect(sendEmail).toHaveBeenCalledTimes(3);
    expect(result.errors[0]).toContain("a@example.com");
    const update = updateCalls.find((c) => c.table === "interviews" && c.id === "iv-1");
    // 재시도 기회가 없는 시점이라, 부분 실패여도 day_before_reminded_at은 그대로 기록한다.
    expect(update?.payload.day_before_reminded_at).toBeDefined();
    expect(update?.payload.note).toContain("a@example.com");
    expect(update?.payload.note).toContain("SMTP 실패");
    expect(update?.payload.note).toContain("자동 재시도가 없으니");
  });

  it("전원 성공하면 day_before_reminded_at만 기록하고 note는 남기지 않는다", async () => {
    vi.mocked(sendEmail).mockResolvedValue(undefined);
    const { client, updateCalls } = fakeSupabase({
      interviews: [interview],
      interviewers,
      rooms: [],
    });

    const result = await sendDayBeforeReminders(client);

    expect(result.sent).toBe(1);
    const update = updateCalls.find((c) => c.table === "interviews" && c.id === "iv-1");
    expect(update?.payload.day_before_reminded_at).toBeDefined();
    expect(update?.payload.note).toBeUndefined();
  });
});
