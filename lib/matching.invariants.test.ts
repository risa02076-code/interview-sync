import { describe, it, expect } from "vitest";
import {
  findMatch,
  recommendLeastConflictSlots,
  isImmediatelyBookable,
  requiresRoom,
  INTERVIEW_TYPES,
  type Interviewer,
} from "./matching";
import { isRoomUsable, type ManagedRoom } from "./rooms";
import { generateUpcomingSlots, occupiedSlots, fitsInBusinessHours, interviewDurationMinutes } from "./slots";

/**
 * 오라클(독립적으로 새로 짠 계산기)과 비교하는 대신, "정답이 뭔지 몰라도 결과가
 * 절대 어기면 안 되는 규칙"을 무작위로 만든 시나리오에 직접 검사한다.
 *
 * 왜 오라클이 아니라 이 방식인가 — 실제로 찾았던 버그("면접실이 없어 막힌 시간이
 * '즉시 확정 가능'으로 잘못 표시됨", 커밋 d3f5f66)는 정답과 비교해야만 알 수 있는
 * 문제가 아니라, "이 결과가 스스로 모순되는지"만 봐도 잡히는 문제였다. 오라클을
 * 새로 짜는 건 똑같은 계산을 하나 더 만드는 것이라 비용이 크고, 원본과 오라클이
 * 같은 규칙을 똑같이 잘못 이해하면 둘 다 틀린 채로 "일치"해버려 오류를 놓칠 수
 * 있다("공유된 오해"). 불변조건 검사는 비교 대상이 되는 두 번째 구현이 아예 없어서
 * 그 위험 자체가 없다 — 대신 "정답이 애매해서 비교가 필요한 경우"(예: 여러 유효한
 * 시간 중 어느 게 최선인가)는 이 방식으로 검증할 수 없다는 한계가 있다.
 *
 * 시드를 고정해서, 실패하면 몇 번째 반복에서 어떤 조합이었는지 그대로 재현할 수
 * 있게 한다(1회성으로 끝났던 예전 무작위 대조의 한계를 같이 메운다). Vitest
 * 테스트라 npm test·prebuild·CI에서 매번 자동으로 다시 돈다(예전처럼 한 번 쓰고
 * 버리지 않는다).
 */

function mulberry32(seed: number) {
  let s = seed;
  return function random(): number {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 20260921;
// recommendLeastConflictSlots가 호출마다 generateUpcomingSlots로 업무일 슬롯을
// 다시 계산해서, 반복 횟수를 늘릴수록 선형으로 느려진다. 이 테스트는 npm test뿐
// 아니라 prebuild(매 배포마다 실행)에도 걸리므로, 커버리지를 위해 배포를 매번
// 몇십 초씩 늦추는 건 안 맞는 거래다. 실패를 몇 번이고 재현 가능한 것(시드 고정)이
// 핵심이지 반복 횟수 자체가 크다고 더 좋아지는 게 아니라서, 느린 환경에서도 몇 초
// 안에 끝나는 수준으로 줄였다.
const ITERATIONS = 60;

type Scenario = {
  interviewers: Interviewer[];
  rooms: ManagedRoom[];
  interviewType: string;
  candidateSlots: string[];
};

function buildScenario(rand: () => number, pool: string[]): Scenario {
  const withProbability = (p: number) => rand() < p;
  const randomSubset = () => pool.filter(() => withProbability(0.15));

  const interviewerCount = 1 + Math.floor(rand() * 5);
  const roomCount = Math.floor(rand() * 5);
  const interviewType = INTERVIEW_TYPES[Math.floor(rand() * INTERVIEW_TYPES.length)];

  const interviewers: Interviewer[] = Array.from({ length: interviewerCount }, (_, i) => ({
    id: `p${i}`,
    name: `면접관${i}`,
    role: "role",
    busy_slots: randomSubset(),
  }));

  const rooms: ManagedRoom[] = Array.from({ length: roomCount }, (_, i) => ({
    id: `r${i}`,
    name: `면접실${i}`,
    busy_slots: randomSubset(),
    // null(정원 미입력) 50% · 정원 충분 25% · 정원 한 자리 모자람 25%를 골고루 섞는다.
    capacity: withProbability(0.5) ? null : interviewerCount + (withProbability(0.5) ? 1 : 0),
    active: withProbability(0.9),
  }));

  const candidateSlots = Array.from(
    { length: 1 + Math.floor(rand() * 3) },
    () => pool[Math.floor(rand() * pool.length)],
  );

  return { interviewers, rooms, interviewType, candidateSlots };
}

describe("매칭 로직 불변조건 (무작위 3,000건 · 오라클 없이 직접 검사 · 시드 고정)", () => {
  const pool = generateUpcomingSlots(5).map((s) => s.key);

  it("findMatch가 '확정'이라고 답한 시간은 반드시 전원 비어있고 업무시간 안에 있으며 방도 쓸 수 있어야 한다", () => {
    const rand = mulberry32(SEED);
    for (let i = 0; i < ITERATIONS; i++) {
      const { interviewers, rooms, interviewType, candidateSlots } = buildScenario(rand, pool);
      const durationMinutes = interviewDurationMinutes(interviewType);
      const roomRequired = requiresRoom(interviewType);
      const ctx = `[반복 ${i}, 시드 ${SEED}] 유형=${interviewType} 면접관=${interviewers.length} 방=${rooms.length}`;

      const result = findMatch(candidateSlots, interviewers, rooms, false, roomRequired, durationMinutes);
      if (result.status !== "confirmed" || !result.matchedSlot) continue;

      const span = occupiedSlots(result.matchedSlot, durationMinutes);

      expect(candidateSlots, `${ctx} — 확정 시간은 후보자가 낸 시간 중 하나여야 한다`).toContain(result.matchedSlot);
      expect(
        fitsInBusinessHours(result.matchedSlot, durationMinutes),
        `${ctx} — 업무시간을 넘겨 끝나면 안 된다`,
      ).toBe(true);

      for (const p of interviewers) {
        expect(
          span.some((s) => p.busy_slots.includes(s)),
          `${ctx} — ${p.name}이 이 시간에 이미 다른 일정이 있는데 확정됨`,
        ).toBe(false);
      }

      if (roomRequired) {
        expect(result.roomId, `${ctx} — 대면 면접인데 방이 배정 안 됨`).not.toBeNull();
        const room = rooms.find((r) => r.id === result.roomId);
        expect(room, `${ctx} — 존재하지 않는 방 id가 배정됨`).toBeDefined();
        expect(isRoomUsable(room!, interviewers.length), `${ctx} — 정원 미달·사용 안 함인 방이 배정됨`).toBe(true);
        expect(
          span.some((s) => room!.busy_slots.includes(s)),
          `${ctx} — 이미 그 시간에 다른 일정이 있는 방이 배정됨`,
        ).toBe(false);
      } else {
        expect(result.roomId, `${ctx} — 방이 필요 없는 유형인데 방이 배정됨`).toBeNull();
      }
    }
  });

  it("recommendLeastConflictSlots가 '즉시 확정 가능'이라 한 시간은 실제로 전원 비고 쓸 수 있는 방도 있어야 한다", () => {
    const rand = mulberry32(SEED + 1);
    for (let i = 0; i < ITERATIONS; i++) {
      const { interviewers, rooms, interviewType } = buildScenario(rand, pool);
      const durationMinutes = interviewDurationMinutes(interviewType);
      const roomRequired = requiresRoom(interviewType);
      const ctx = `[반복 ${i}, 시드 ${SEED + 1}] 유형=${interviewType} 면접관=${interviewers.length} 방=${rooms.length}`;

      const recs = recommendLeastConflictSlots(interviewers, rooms, roomRequired, 5, [], durationMinutes);
      for (const r of recs) {
        if (!isImmediatelyBookable(r)) continue;

        const span = occupiedSlots(r.slot, durationMinutes);
        const actualConflicts = interviewers.filter((p) => span.some((s) => p.busy_slots.includes(s)));
        expect(
          actualConflicts,
          `${ctx}, 슬롯=${r.slot} — "즉시 확정 가능"이라 했는데 실제로 못 오는 면접관이 있다(이게 바로 실제로 찾았던 버그의 재현 조건이다)`,
        ).toHaveLength(0);

        if (roomRequired) {
          const hasFreeUsableRoom = rooms.some(
            (room) => isRoomUsable(room, interviewers.length) && span.every((s) => !room.busy_slots.includes(s)),
          );
          expect(
            hasFreeUsableRoom,
            `${ctx}, 슬롯=${r.slot} — "즉시 확정 가능"이라 했는데 실제로 쓸 수 있는 방이 없다`,
          ).toBe(true);
        }
      }
    }
  }, 30000);
});
