import type { Interviewer, Room } from "./matching";
import { formatSlotRangeLabel, interviewDurationMinutes, occupiedSlots } from "./slots";

/**
 * 소요시간(INTERVIEW_DURATION_MINUTES)을 도입하기 전에 확정된 면접들은
 * busy_slots에 **시작 슬롯 하나만** 들어 있다. 새로 확정되는 건은
 * applyMatch가 구간 전체를 점유하므로 정확하지만, 옛 건들은 뒷 30분이 여전히
 * 비어 있는 것으로 보여 같은 면접관·면접실에 겹치는 면접이 또 잡힐 수 있다.
 *
 * 이 모듈은 그 구멍을 소급해서 메우기 위한 "무엇을 고쳐야 하는지" 계산만
 * 담당한다(순수 함수 — DB 접근 없음). 실제 쓰기는 scripts/backfill-busy-slots.ts가 한다.
 *
 * 계산은 슬롯을 **더하기만 한다**. 확정이 풀린 뒤에도 남아 있는 옛 슬롯을 지우는
 * 일은 하지 않는다 — busy_slots에는 면접관이 스스로 표시한 "개인 일정"도 섞여
 * 있어서, 어떤 항목이 면접 때문에 생긴 것인지 데이터만으로는 구분할 수 없다.
 * 잘못 지우면 없는 시간에 면접이 잡히므로, 안전한 방향(더하기)만 자동화한다.
 */
export type BackfillInterview = {
  id: string;
  candidate_name: string;
  interview_type: string;
  panel: string[];
  matched_slot: string | null;
  room_id: string | null;
  status: "confirmed" | "rescheduled" | "escalated" | "pending";
};

/** 한 대상(면접관 1명 또는 면접실 1개)에 대해 추가해야 할 슬롯. */
export type BackfillFix = {
  table: "interviewers" | "rooms";
  id: string;
  name: string;
  /** 지금 DB에 들어 있는 값 */
  currentSlots: string[];
  /** 빠져 있어서 새로 넣어야 하는 슬롯(정렬·중복 제거됨) */
  missingSlots: string[];
  /** 실제로 저장할 값 = currentSlots + missingSlots */
  nextSlots: string[];
  /** 왜 필요한지 — "누구의 몇 시 면접 때문인지"를 사람이 읽을 수 있게 */
  reasons: string[];
};

/** 계산은 됐지만 참조하는 행이 DB에 없어서 손댈 수 없는 경우. */
export type BackfillSkip = {
  interviewId: string;
  candidateName: string;
  reason: string;
};

export type BackfillPlan = {
  fixes: BackfillFix[];
  skipped: BackfillSkip[];
};

/**
 * 확정된 면접들이 실제로 점유해야 하는 슬롯과 지금 저장된 busy_slots를 대조해,
 * 빠져 있는 슬롯 목록을 대상별로 모은다.
 *
 * 시작 슬롯 자체가 빠져 있는 경우도 함께 잡힌다 — 확정 중간에 update가 실패해
 * "확정됐다고 적혀 있는데 캘린더는 비어 있는" 반쪽 상태(README의 알려진 한계)가
 * 남았을 때가 그렇다. 소요시간 도입 이전 건이든 반쪽 확정이든, 고치는 방향은
 * "구간 전체를 점유로 만든다"로 같다.
 */
export function planBusySlotsBackfill(
  interviews: BackfillInterview[],
  interviewers: Interviewer[],
  rooms: Room[],
): BackfillPlan {
  const interviewerById = new Map(interviewers.map((i) => [i.id, i]));
  const roomById = new Map(rooms.map((r) => [r.id, r]));

  // 여러 면접이 같은 면접관을 공유하므로, 대상별로 한 번에 모아서 한 번만 쓴다.
  const pending = new Map<string, { fix: BackfillFix; missing: Set<string> }>();
  const skipped: BackfillSkip[] = [];

  const collect = (
    table: BackfillFix["table"],
    row: { id: string; name: string; busy_slots: string[] } | undefined,
    span: string[],
    reason: string,
  ) => {
    if (!row) return;
    const key = `${table}:${row.id}`;
    let entry = pending.get(key);
    if (!entry) {
      entry = {
        fix: {
          table,
          id: row.id,
          name: row.name,
          currentSlots: row.busy_slots ?? [],
          missingSlots: [],
          nextSlots: [],
          reasons: [],
        },
        missing: new Set<string>(),
      };
      pending.set(key, entry);
    }
    const already = new Set(entry.fix.currentSlots);
    const newlyMissing = span.filter((s) => !already.has(s) && !entry!.missing.has(s));
    if (!newlyMissing.length) return;
    newlyMissing.forEach((s) => entry!.missing.add(s));
    entry.fix.reasons.push(reason);
  };

  for (const iv of interviews) {
    const occupies = iv.status === "confirmed" || iv.status === "rescheduled";
    if (!occupies || !iv.matched_slot) continue;

    const duration = interviewDurationMinutes(iv.interview_type);
    const span = occupiedSlots(iv.matched_slot, duration);
    const reason = `${iv.candidate_name} — ${iv.interview_type} ${formatSlotRangeLabel(
      iv.matched_slot,
      duration,
    )}`;

    for (const interviewerId of iv.panel) {
      const row = interviewerById.get(interviewerId);
      if (!row) {
        skipped.push({
          interviewId: iv.id,
          candidateName: iv.candidate_name,
          reason: `패널에 있는 면접관(${interviewerId})이 interviewers 테이블에 없음`,
        });
        continue;
      }
      collect("interviewers", row, span, reason);
    }

    if (iv.room_id) {
      const room = roomById.get(iv.room_id);
      if (!room) {
        skipped.push({
          interviewId: iv.id,
          candidateName: iv.candidate_name,
          reason: `배정된 면접실(${iv.room_id})이 rooms 테이블에 없음`,
        });
        continue;
      }
      collect("rooms", room, span, reason);
    }
  }

  const fixes: BackfillFix[] = [];
  for (const { fix, missing } of pending.values()) {
    if (!missing.size) continue;
    fix.missingSlots = [...missing].sort();
    fix.nextSlots = [...fix.currentSlots, ...fix.missingSlots];
    fixes.push(fix);
  }
  // 사람이 확인하기 좋게 항상 같은 순서로 낸다.
  fixes.sort((a, b) => `${a.table}:${a.name}`.localeCompare(`${b.table}:${b.name}`));

  return { fixes, skipped };
}
