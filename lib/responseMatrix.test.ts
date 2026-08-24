import { describe, it, expect } from "vitest";
import { buildResponseMatrix, heatInputs, overlapsMatched, type MatrixInterviewer } from "./responseMatrix";

// 시간대를 명시한 Z 문자열만 쓴다 — 실행 환경(KST/UTC)에 따라 답이 달라지지 않도록.
const NINE = "2024-01-02T00:00:00.000Z"; // 09:00 KST
const NINE_30 = "2024-01-02T00:30:00.000Z"; // 09:30 KST
const TEN = "2024-01-02T01:00:00.000Z"; // 10:00 KST
const TEN_30 = "2024-01-02T01:30:00.000Z"; // 10:30 KST
const LAST = "2024-01-02T08:30:00.000Z"; // 17:30 KST — 마지막 슬롯
const PAST = "2023-12-20T00:00:00.000Z"; // 지난 라운드 슬롯

const GRID = [NINE, NINE_30, TEN, TEN_30, LAST];

function person(over: Partial<MatrixInterviewer> & { name: string }): MatrixInterviewer {
  return { id: over.name, responded: true, busy_slots: [], ...over };
}

function build(over: Partial<Parameters<typeof buildResponseMatrix>[0]> = {}) {
  return buildResponseMatrix({
    interviewers: [],
    rooms: [{ id: "r1", name: "면접실 A", busy_slots: [] }],
    preferredSlots: [],
    matchedSlot: null,
    gridSlots: GRID,
    needsRoom: true,
    durationMinutes: 60,
    ...over,
  });
}

describe("사람 분류", () => {
  it("응답을 마치고 불가능하다고 표시한 사람은 unavailable이다", () => {
    const { states } = build({ interviewers: [person({ name: "배지훈", busy_slots: [NINE] })] });
    expect(states.get(NINE)!.unavailable).toEqual(["배지훈"]);
    expect(states.get(NINE)!.available).toEqual([]);
  });

  it("응답을 마치고 표시하지 않은 시간은 available이다", () => {
    const { states } = build({ interviewers: [person({ name: "배지훈", busy_slots: [NINE] })] });
    expect(states.get(TEN)!.available).toEqual(["배지훈"]);
  });

  it("아직 답하지 않은 사람은 available이 아니라 unknown이다", () => {
    const { states } = build({ interviewers: [person({ name: "오세훈", responded: false })] });
    const s = states.get(NINE)!;
    expect(s.unknown).toEqual(["오세훈"]);
    expect(s.available).toEqual([]);
    expect(s.unavailable).toEqual([]);
  });

  it("미응답자와 응답자가 섞이면 각각 다른 칸에 들어간다", () => {
    const { states } = build({
      interviewers: [
        person({ name: "배지훈", busy_slots: [NINE] }),
        person({ name: "오세훈", responded: false }),
      ],
    });
    const s = states.get(NINE)!;
    expect(s.unavailable).toEqual(["배지훈"]);
    expect(s.unknown).toEqual(["오세훈"]);
  });
});

describe("확정 구간의 모호함", () => {
  // 확정되면 busy_slots에 확정 시간이 추가된다(lib/applyMatch.ts). 그래서 그 항목이
  // "본인이 안 된다고 한 것"인지 "이 면접이 잡힌 것"인지 구분할 수 없다.
  it("확정 구간에 busy_slots가 걸린 사람은 unavailable이 아니라 ambiguous다", () => {
    const { states } = build({
      matchedSlot: NINE,
      interviewers: [person({ name: "배지훈", busy_slots: [NINE, NINE_30] })],
    });
    expect(states.get(NINE)!.ambiguous).toEqual(["배지훈"]);
    expect(states.get(NINE)!.unavailable).toEqual([]);
    expect(states.get(NINE_30)!.ambiguous).toEqual(["배지훈"]);
  });

  it("참석 가능하다고 직접 답한 기록이 있으면 확정 구간도 모호하지 않고 available이다", () => {
    const { states } = build({
      matchedSlot: NINE,
      interviewers: [
        person({ name: "배지훈", busy_slots: [NINE, NINE_30], attendanceConfirmedStarts: [NINE] }),
      ],
    });
    expect(states.get(NINE)!.available).toEqual(["배지훈"]);
    expect(states.get(NINE)!.ambiguous).toEqual([]);
  });

  it("참석 가능 답변은 시작 슬롯 하나지만 면접 구간 전체(뒷 30분)까지 덮는다", () => {
    const { states } = build({
      matchedSlot: NINE,
      interviewers: [
        person({ name: "배지훈", busy_slots: [NINE, NINE_30], attendanceConfirmedStarts: [NINE] }),
      ],
    });
    expect(states.get(NINE_30)!.available).toEqual(["배지훈"]);
    expect(states.get(NINE_30)!.ambiguous).toEqual([]);
  });

  it("같은 패널이라도 답한 사람만 모호함이 풀린다", () => {
    const { states } = build({
      matchedSlot: NINE,
      interviewers: [
        person({ name: "배지훈", busy_slots: [NINE, NINE_30], attendanceConfirmedStarts: [NINE] }),
        person({ name: "오세훈", busy_slots: [NINE, NINE_30] }),
      ],
    });
    expect(states.get(NINE)!.available).toEqual(["배지훈"]);
    expect(states.get(NINE)!.ambiguous).toEqual(["오세훈"]);
  });

  it("다른 시간에 참석 가능이라고 답한 기록은 확정 구간의 모호함을 풀지 않는다", () => {
    const { states } = build({
      matchedSlot: NINE,
      interviewers: [
        person({ name: "배지훈", busy_slots: [NINE, NINE_30], attendanceConfirmedStarts: [TEN_30] }),
      ],
    });
    expect(states.get(NINE)!.ambiguous).toEqual(["배지훈"]);
  });

  it("확정 구간 밖에서는 참석 가능 답변이 busy_slots를 덮어쓰지 않는다", () => {
    // 답변 이후에 본인 사정이 생겨 busy_slots에 다시 들어갔을 수 있다. 확정된
    // 구간이 아니라면 busy_slots가 더 최신이므로 그대로 불가능으로 본다.
    const { states } = build({
      matchedSlot: null,
      interviewers: [person({ name: "배지훈", busy_slots: [TEN], attendanceConfirmedStarts: [TEN] })],
    });
    expect(states.get(TEN)!.unavailable).toEqual(["배지훈"]);
  });

  it("확정 구간 밖은 그대로 unavailable로 분류한다", () => {
    const { states } = build({
      matchedSlot: NINE,
      interviewers: [person({ name: "배지훈", busy_slots: [NINE, NINE_30, TEN_30] })],
    });
    expect(states.get(TEN_30)!.unavailable).toEqual(["배지훈"]);
  });

  it("확정 시작 슬롯과 점유 구간을 표시한다", () => {
    const { states } = build({ matchedSlot: NINE });
    expect(states.get(NINE)!.isMatchedStart).toBe(true);
    expect(states.get(NINE)!.occupiedByMatch).toBe(true);
    expect(states.get(NINE_30)!.isMatchedStart).toBe(false);
    expect(states.get(NINE_30)!.occupiedByMatch).toBe(true);
    expect(states.get(TEN)!.occupiedByMatch).toBe(false);
  });
});

describe("시간 축", () => {
  it("격자에 없는 지난 라운드 슬롯도 축에 포함한다", () => {
    const { slots } = build({ historySlots: [PAST] });
    expect(slots).toContain(PAST);
    expect(slots[0]).toBe(PAST); // 시간순 정렬
  });

  it("응답에만 등장하는 슬롯도 축에 포함한다", () => {
    const { slots } = build({ interviewers: [person({ name: "배지훈", busy_slots: [PAST] })] });
    expect(slots).toContain(PAST);
  });

  it("중복 없이 시간순으로 정렬한다", () => {
    const { slots } = build({ historySlots: [TEN, NINE], preferredSlots: [NINE] });
    expect(slots).toEqual([...GRID].sort());
  });
});

describe("후보자 순위", () => {
  it("제출 순서가 1·2·3순위가 된다", () => {
    const { states } = build({ preferredSlots: [TEN, NINE, TEN_30] });
    expect(states.get(TEN)!.candidateRank).toBe(1);
    expect(states.get(NINE)!.candidateRank).toBe(2);
    expect(states.get(TEN_30)!.candidateRank).toBe(3);
    expect(states.get(NINE_30)!.candidateRank).toBeNull();
  });
});

describe("startable — findMatch와 같은 기준", () => {
  it("뒤 30분이 막혀 있으면 1시간 면접은 시작할 수 없다", () => {
    const { states } = build({ interviewers: [person({ name: "배지훈", busy_slots: [NINE_30] })] });
    expect(states.get(NINE)!.startable).toBe(false);
    expect(states.get(TEN)!.startable).toBe(true);
  });

  it("30분 면접이면 같은 상황에서도 시작할 수 있다", () => {
    const { states } = build({
      durationMinutes: 30,
      interviewers: [person({ name: "배지훈", busy_slots: [NINE_30] })],
    });
    expect(states.get(NINE)!.startable).toBe(true);
  });

  it("업무시간을 넘겨 끝나는 시작 시간은 시작할 수 없다", () => {
    const { states } = build();
    expect(states.get(LAST)!.startable).toBe(false); // 17:30 + 60분
  });

  it("확정된 면접 자신의 점유는 시작 불가로 보지 않는다", () => {
    const { states } = build({
      matchedSlot: NINE,
      interviewers: [person({ name: "배지훈", busy_slots: [NINE, NINE_30] })],
    });
    expect(states.get(NINE)!.startable).toBe(true);
  });

  it("미응답자는 findMatch와 마찬가지로 가능으로 취급된다 — 그래서 unknown을 함께 봐야 한다", () => {
    const { states } = build({ interviewers: [person({ name: "오세훈", responded: false })] });
    const s = states.get(NINE)!;
    expect(s.startable).toBe(true);
    expect(s.unknown).toEqual(["오세훈"]); // 통과의 근거가 답변이 아니라 침묵이다
  });
});

describe("회의실", () => {
  it("구간 전체가 비어 있어야 회의실이 있다고 본다", () => {
    const { states } = build({ rooms: [{ id: "r1", name: "A", busy_slots: [NINE_30] }] });
    expect(states.get(NINE)!.roomFree).toBe(false);
    expect(states.get(TEN)!.roomFree).toBe(true);
  });

  it("회의실이 필요 없는 유형이면 항상 true다", () => {
    const { states } = build({ needsRoom: false, rooms: [] });
    expect(states.get(NINE)!.roomFree).toBe(true);
  });
});

describe("heatInputs", () => {
  it("불가능하다고 답한 인원 수를 색으로, 미응답 여부를 별도 신호로 낸다", () => {
    const { states } = build({
      interviewers: [
        person({ name: "배지훈", busy_slots: [NINE] }),
        person({ name: "오세훈", responded: false }),
      ],
    });
    expect(heatInputs(states.get(NINE)!)).toEqual({ conflictCount: 1, estimated: true });
  });

  it("회의실이 없으면 충돌 하나로 센다", () => {
    const { states } = build({ rooms: [{ id: "r1", name: "A", busy_slots: [NINE, NINE_30] }] });
    expect(heatInputs(states.get(NINE)!).conflictCount).toBe(1);
  });
});

describe("overlapsMatched", () => {
  it("확정 시간과 구간이 겹치면 true다", () => {
    expect(overlapsMatched(NINE_30, NINE, 60)).toBe(true);
    expect(overlapsMatched(TEN, NINE, 60)).toBe(false);
  });

  it("확정 전이면 항상 false다", () => {
    expect(overlapsMatched(NINE, null, 60)).toBe(false);
  });
});
