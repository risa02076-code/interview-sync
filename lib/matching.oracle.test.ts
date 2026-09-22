import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { findMatch, requiresRoom, type Interviewer } from "./matching";
import type { ManagedRoom } from "./rooms";
import { generateUpcomingSlots, interviewDurationMinutes } from "./slots";
import { oracleFindMatch, type OracleInterviewer, type OracleRoom } from "./matching.oracle";

/**
 * findMatch(원본)와 oracleFindMatch(PRD.md §7 규칙만 보고 독립적으로 새로 짠
 * 계산기)를 무작위 시나리오로 대조한다. 예전 1만 건 무작위 대조와 목적은 같지만
 * 세 가지가 다르다.
 *
 * 1. 저장소에 남는다 — 그때는 1회성 스크립트로 쓰고 버렸지만, 이건 Vitest 테스트라
 *    npm test·prebuild·CI에서 매번 자동으로 다시 돈다.
 * 2. 시드가 고정돼 있다 — fast-check의 { seed } 옵션으로, 실패하면 항상 같은
 *    조합을 재현할 수 있다.
 * 3. 실패 케이스를 자동으로 축소한다 — fast-check이 실패를 발견하면, 그 실패를
 *    재현하는 "가장 단순한 반례"로 자동으로 줄여서 보여준다(shrinking). 예전엔
 *    실패한 복잡한 무작위 조합을 사람이 직접 들여다보며 원인을 찾아야 했다.
 *
 * "공유된 오해"(원본과 오라클이 같은 규칙을 똑같이 잘못 이해하는 것) 위험은 여전히
 * 남는다 — 그래서 오라클은 lib/matching.ts·lib/slots.ts·lib/rooms.ts의 함수를
 * 하나도 재사용하지 않고, PRD.md에 사용자가 직접 확정한 숫자만 보고 새로 짰다
 * (lib/matching.oracle.ts 참고).
 */

const INTERVIEW_TYPES = ["1차 대면", "2차 대면", "온라인", "전화"] as const;
const SEED = 20260922;
const NUM_RUNS = 300;

describe("findMatch vs 독립 오라클 (fast-check, 시드 고정)", () => {
  it("두 계산기는 같은 시나리오에서 항상 같은 시간·같은 면접실을 확정한다", () => {
    // 업무일 슬롯 풀을 매 실행 한 번만 계산한다(recommendLeastConflictSlots와 달리
    // findMatch는 후보 슬롯을 인자로 받을 뿐 내부에서 다시 계산하지 않아 가볍다).
    const pool = generateUpcomingSlots(5).map((s) => s.key);

    const interviewerArb = fc.record({
      id: fc.uuid(),
      name: fc.constant("면접관"),
      role: fc.constant("역할"),
      busy_slots: fc.subarray(pool, { maxLength: 12 }),
    });

    const roomArb = fc.record({
      id: fc.uuid(),
      name: fc.constant("면접실"),
      busy_slots: fc.subarray(pool, { maxLength: 12 }),
      capacity: fc.option(fc.integer({ min: 0, max: 8 }), { nil: null }),
      active: fc.boolean(),
    });

    const scenarioArb = fc.record({
      interviewers: fc.array(interviewerArb, { minLength: 1, maxLength: 5 }),
      rooms: fc.array(roomArb, { minLength: 0, maxLength: 4 }),
      interviewType: fc.constantFrom(...INTERVIEW_TYPES),
      candidateSlots: fc.shuffledSubarray(pool, { minLength: 1, maxLength: 3 }),
    });

    fc.assert(
      fc.property(scenarioArb, ({ interviewers, rooms, interviewType, candidateSlots }) => {
        const roomRequired = requiresRoom(interviewType);
        const durationMinutes = interviewDurationMinutes(interviewType);

        const real = findMatch(
          candidateSlots,
          interviewers as Interviewer[],
          rooms as ManagedRoom[],
          false,
          roomRequired,
          durationMinutes,
        );
        const oracle = oracleFindMatch(
          candidateSlots,
          interviewers as OracleInterviewer[],
          rooms as OracleRoom[],
          interviewType,
          roomRequired,
        );

        expect(real.matchedSlot).toBe(oracle.matchedSlot);
        // 방 자체가 어느 쪽이든 될 수 있는 동점 상황(정원 무제한 방이 여러 개)은
        // "쓸 수 있는 방이 있었는지"만 비교하고, 정확히 같은 id까지는 요구하지 않는다.
        expect(real.roomId === null).toBe(oracle.roomId === null);
      }),
      { seed: SEED, numRuns: NUM_RUNS },
    );
  });
});
