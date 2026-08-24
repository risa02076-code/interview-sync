import { describe, it, expect } from "vitest";
import { planBusySlotsBackfill, type BackfillInterview } from "./backfillBusySlots";
import type { Interviewer, Room } from "./matching";

const SLOT_10 = "2024-01-02T01:00:00.000Z"; // 10:00 KST
const SLOT_1030 = "2024-01-02T01:30:00.000Z"; // 10:30 KST
const SLOT_14 = "2024-01-02T05:00:00.000Z"; // 14:00 KST
const SLOT_1430 = "2024-01-02T05:30:00.000Z"; // 14:30 KST

function interview(overrides: Partial<BackfillInterview> = {}): BackfillInterview {
  return {
    id: "iv1",
    candidate_name: "후보자1",
    interview_type: "1차 대면", // 60분 — 슬롯 두 칸을 점유한다
    panel: ["p1"],
    matched_slot: SLOT_10,
    room_id: "r1",
    status: "confirmed",
    ...overrides,
  };
}

function person(overrides: Partial<Interviewer> = {}): Interviewer {
  return { id: "p1", name: "면접관1", role: "개발", busy_slots: [], ...overrides };
}

function room(overrides: Partial<Room> = {}): Room {
  return { id: "r1", name: "면접실1", busy_slots: [], ...overrides };
}

describe("planBusySlotsBackfill", () => {
  it("시작 슬롯만 들어 있는 옛 1시간 면접에 뒷 30분을 채운다", () => {
    const plan = planBusySlotsBackfill(
      [interview()],
      [person({ busy_slots: [SLOT_10] })],
      [room({ busy_slots: [SLOT_10] })],
    );

    expect(plan.skipped).toEqual([]);
    expect(plan.fixes).toHaveLength(2);
    for (const fix of plan.fixes) {
      expect(fix.missingSlots).toEqual([SLOT_1030]);
      expect(fix.nextSlots).toEqual([SLOT_10, SLOT_1030]);
    }
    expect(plan.fixes.map((f) => f.table).sort()).toEqual(["interviewers", "rooms"]);
  });

  it("이미 구간 전체가 들어 있으면 아무것도 고치지 않는다", () => {
    const plan = planBusySlotsBackfill(
      [interview()],
      [person({ busy_slots: [SLOT_10, SLOT_1030] })],
      [room({ busy_slots: [SLOT_10, SLOT_1030] })],
    );

    expect(plan.fixes).toEqual([]);
  });

  it("30분 면접(온라인)은 면접실도 없고 채울 것도 없다", () => {
    const plan = planBusySlotsBackfill(
      [interview({ interview_type: "온라인", room_id: null })],
      [person({ busy_slots: [SLOT_10] })],
      [room()],
    );

    expect(plan.fixes).toEqual([]);
  });

  it("확정 자체가 반쪽만 적용돼 시작 슬롯까지 비어 있으면 구간 전체를 채운다", () => {
    const plan = planBusySlotsBackfill([interview()], [person({ busy_slots: [] })], [room()]);

    const fix = plan.fixes.find((f) => f.table === "interviewers")!;
    expect(fix.missingSlots).toEqual([SLOT_10, SLOT_1030]);
  });

  it("확정되지 않은 면접(pending·escalated)은 점유로 보지 않는다", () => {
    const plan = planBusySlotsBackfill(
      [
        interview({ id: "iv1", status: "pending", matched_slot: null }),
        interview({ id: "iv2", status: "escalated", matched_slot: SLOT_10 }),
      ],
      [person()],
      [room()],
    );

    expect(plan.fixes).toEqual([]);
  });

  it("재조율된 건(rescheduled)도 확정과 똑같이 점유한다", () => {
    const plan = planBusySlotsBackfill(
      [interview({ status: "rescheduled" })],
      [person()],
      [room()],
    );

    expect(plan.fixes.find((f) => f.table === "interviewers")!.missingSlots).toEqual([
      SLOT_10,
      SLOT_1030,
    ]);
  });

  it("같은 면접관이 여러 면접에 걸쳐 있으면 한 번의 수정으로 합쳐서 낸다", () => {
    const plan = planBusySlotsBackfill(
      [
        interview({ id: "iv1", matched_slot: SLOT_10, room_id: "r1" }),
        interview({ id: "iv2", matched_slot: SLOT_14, room_id: "r2" }),
      ],
      [person({ busy_slots: [SLOT_10, SLOT_14] })],
      [room({ id: "r1", busy_slots: [SLOT_10] }), room({ id: "r2", busy_slots: [SLOT_14] })],
    );

    const fixes = plan.fixes.filter((f) => f.table === "interviewers");
    expect(fixes).toHaveLength(1);
    expect(fixes[0].missingSlots).toEqual([SLOT_1030, SLOT_1430]);
    // 어떤 면접 때문에 필요한지 두 건 모두 사유로 남는다
    expect(fixes[0].reasons).toHaveLength(2);
  });

  it("같은 슬롯을 두 면접이 요구해도 중복해서 넣지 않는다", () => {
    const plan = planBusySlotsBackfill(
      [
        interview({ id: "iv1", panel: ["p1"], room_id: null, interview_type: "온라인" }),
        interview({ id: "iv2", panel: ["p1"], room_id: null, interview_type: "온라인" }),
      ],
      [person({ busy_slots: [] })],
      [],
    );

    expect(plan.fixes[0].missingSlots).toEqual([SLOT_10]);
    expect(plan.fixes[0].nextSlots).toEqual([SLOT_10]);
  });

  it("busy_slots에 있던 기존 값은 순서를 유지한 채 보존한다", () => {
    const unrelated = "2024-01-03T02:00:00.000Z";
    const plan = planBusySlotsBackfill(
      [interview({ room_id: null, interview_type: "온라인" })],
      [person({ busy_slots: [unrelated] })],
      [],
    );

    expect(plan.fixes[0].nextSlots).toEqual([unrelated, SLOT_10]);
  });

  it("패널에 있는 면접관 행이 없으면 고치지 않고 건너뛴 이유를 남긴다", () => {
    const plan = planBusySlotsBackfill(
      [interview({ panel: ["없는사람"], room_id: null, interview_type: "온라인" })],
      [person()],
      [],
    );

    expect(plan.fixes).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0].reason).toContain("없는사람");
  });

  it("배정된 면접실 행이 없으면 건너뛴 이유를 남긴다", () => {
    const plan = planBusySlotsBackfill(
      [interview({ room_id: "없는방" })],
      [person({ busy_slots: [SLOT_10, SLOT_1030] })],
      [],
    );

    expect(plan.fixes).toEqual([]);
    expect(plan.skipped[0].reason).toContain("없는방");
  });
});
