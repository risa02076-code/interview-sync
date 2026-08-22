"use client";

import { useEffect, useState, useMemo, useRef, use } from "react";
import { Button } from "@/components/ui/button";
import { SlotGrid } from "@/components/slot-grid";
import { KST_NOTICE, kstDateLabel, kstDayKey } from "@/lib/slots";

type Slot = { key: string; label: string };

type Context = {
  kind: "candidate" | "interviewer" | "priority_confirm" | "reschedule_request" | "candidate_wide_availability";
  status: "pending" | "submitted";
  name: string;
  subtitle: string;
  slots: Slot[];
  preSelected?: string[];
  othersBusy?: string[];
  candidateName?: string;
  position?: string;
  alreadyBusy?: string[];
  currentSlotLabel?: string | null;
};

/** 후보자 응답 페이지에서 면접관 가용 시간이 바뀌었는지 확인하는 주기 */
const POLL_MS = 20_000;

const RANK_MEDAL = ["🥇", "🥈", "🥉"];
const MAX_RANKS = 3;

/**
 * ISO 슬롯 키를 날짜별로 묶는다 — 날짜를 먼저 고르고 그 안에서 시간을 고르는 느낌을 주기 위함.
 *
 * 이 화면은 후보자와 면접관이 여는 화면이고, 해외에 있을 수 있다. 그래서 날짜
 * 묶음과 라벨을 모두 한국 시간 기준으로 고정한다 — 로컬 시간으로 계산하면
 * 08/25 09:00 슬롯이 08/24 밤으로 보이고, 그걸 보고 고른 시간이 실제로는 다른
 * 시간이 된다.
 */
function groupByDay(slots: Slot[]) {
  const order: string[] = [];
  const labels = new Map<string, string>();
  const items = new Map<string, Slot[]>();

  for (const slot of slots) {
    const dayKey = kstDayKey(slot.key);
    if (!items.has(dayKey)) {
      order.push(dayKey);
      labels.set(dayKey, kstDateLabel(slot.key));
      items.set(dayKey, []);
    }
    items.get(dayKey)!.push(slot);
  }

  return order.map((dayKey) => ({ dayKey, dayLabel: labels.get(dayKey)!, slots: items.get(dayKey)! }));
}

export default function RespondPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [available, setAvailable] = useState<Set<string>>(new Set());
  const [rescheduleAvailable, setRescheduleAvailable] = useState<Set<string>>(new Set());
  const [wideAvailable, setWideAvailable] = useState<Set<string>>(new Set());
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateDate, setEscalateDate] = useState("");
  const [escalateReason, setEscalateReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [doneReason, setDoneReason] = useState<"confirmed" | "requested-more" | "priorities-submitted" | null>(
    null,
  );

  // 후보자 화면에서 방금 사라진 시간(잠깐 취소선으로 보여줌)과, 이미 선택했다가
  // 사라진 시간(경고 배너로 알려줘야 함)을 추적한다.
  const [justRemoved, setJustRemoved] = useState<Slot[]>([]);
  const [removedWhileRanked, setRemovedWhileRanked] = useState<Slot[]>([]);
  const ctxRef = useRef<Context | null>(null);
  const selectedRef = useRef<string[]>([]);
  ctxRef.current = ctx;
  selectedRef.current = selected;

  useEffect(() => {
    fetch(`/api/respond/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error);
        return res.json();
      })
      .then((data: Context) => {
        setCtx(data);
        // 재문의 라운드에서는 이전에 자신이 표시했던 불가능한 시간을 그대로 이어서 보여준다.
        if (data.kind === "interviewer" && data.preSelected?.length) {
          setSelected(data.preSelected);
        }
        // 이미 불가능하다고 표시된 시간을 제외한 나머지를 기본으로 "참석 가능"에 체크해둔다.
        if (data.kind === "priority_confirm") {
          const busy = new Set(data.alreadyBusy ?? []);
          setAvailable(new Set(data.slots.map((s) => s.key).filter((k) => !busy.has(k))));
        }
      })
      .catch((e) => setError(e.message));
  }, [token]);

  // 후보자 화면은 응답을 미루는 동안 면접관 일정이 바뀔 수 있으므로, 주기적으로
  // 다시 조회해서 최신 시간으로 갱신한다. 사라진 시간은 조용히 지우지 않고 알려준다.
  useEffect(() => {
    if (ctx?.kind !== "candidate" || done) return;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/respond/${token}`);
      if (!res.ok) return;
      const data: Context = await res.json();

      const prevSlots = ctxRef.current?.slots ?? [];
      const newKeys = new Set(data.slots.map((s) => s.key));
      const removed = prevSlots.filter((s) => !newKeys.has(s.key));

      if (removed.length) {
        setJustRemoved(removed);
        const removedKeys = new Set(removed.map((s) => s.key));
        const currentRanked = selectedRef.current;
        const droppedFromRanked = currentRanked.filter((k) => removedKeys.has(k));
        if (droppedFromRanked.length) {
          setRemovedWhileRanked((cur) => [
            ...cur,
            ...prevSlots.filter((s) => droppedFromRanked.includes(s.key)),
          ]);
          setSelected((cur) => cur.filter((k) => !removedKeys.has(k)));
        }
      } else {
        setJustRemoved([]);
      }

      setCtx(data);
    }, POLL_MS);
    return () => clearInterval(interval);
  }, [token, ctx?.kind, done]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function toggleCandidateRank(key: string) {
    setSelected((cur) => {
      if (cur.includes(key)) return cur.filter((k) => k !== key);
      if (cur.length >= MAX_RANKS) return cur;
      return [...cur, key];
    });
  }

  function paintInterviewerSlot(key: string, select: boolean) {
    setSelected((cur) => {
      const set = new Set(cur);
      if (select) set.add(key);
      else set.delete(key);
      return Array.from(set);
    });
  }

  function paintReschedule(key: string, select: boolean) {
    setRescheduleAvailable((cur) => {
      const next = new Set(cur);
      if (select) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function paintWideAvailable(key: string, select: boolean) {
    setWideAvailable((cur) => {
      const next = new Set(cur);
      if (select) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  function toggleAvailable(key: string) {
    setAvailable((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const isCandidate = ctx?.kind === "candidate";
    const res = await fetch(`/api/respond/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(isCandidate ? { preferredSlots: selected } : { selectedSlots: selected }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "제출에 실패했습니다.");
      return;
    }
    if (isCandidate) setDoneReason("priorities-submitted");
    setDone(true);
  }

  async function submitReschedule() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/respond/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ availableSlots: Array.from(rescheduleAvailable) }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "요청에 실패했습니다.");
      return;
    }
    setDone(true);
  }

  async function submitPriorityConfirm() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/respond/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ availableSlots: Array.from(available) }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "제출에 실패했습니다.");
      return;
    }
    setDone(true);
  }

  async function submitAllUnavailable() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/respond/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ allUnavailable: true }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "제출에 실패했습니다.");
      return;
    }
    // 서버에서 이 링크의 kind가 candidate_wide_availability로 바뀌었으니, 다시 불러와서
    // 다음 단계(다음 주 가능한 시간 체크) 화면으로 곧바로 넘어간다.
    const refreshed = await fetch(`/api/respond/${token}`);
    if (refreshed.ok) setCtx(await refreshed.json());
  }

  async function submitWideAvailability() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/respond/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ availableSlots: Array.from(wideAvailable) }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "제출에 실패했습니다.");
      return;
    }
    setDoneReason("requested-more");
    setDone(true);
  }

  async function submitEscalateNote() {
    setSubmitting(true);
    setError(null);
    const note = [
      escalateDate ? `가능한 시점: ${escalateDate}` : null,
      escalateReason.trim() ? `사유: ${escalateReason.trim()}` : null,
    ]
      .filter(Boolean)
      .join(" / ");
    const res = await fetch(`/api/respond/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ availableSlots: [], candidateNote: note }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "제출에 실패했습니다.");
      return;
    }
    setDone(true);
  }

  async function submitInterviewerAllUnavailable() {
    if (!ctx) return;
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/respond/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // 이 기간 전체를 불가능으로 제출하면서, 다른 면접관 응답을 기다리지 않고
      // 곧바로 재문의(조회 기간 확장)로 넘어가도록 표시한다.
      body: JSON.stringify({ selectedSlots: ctx.slots.map((s) => s.key), allUnavailable: true }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "제출에 실패했습니다.");
      return;
    }
    setDoneReason("requested-more");
    setDone(true);
  }

  if (error) {
    return <p className="mx-auto max-w-md p-6 text-sm text-destructive">{error}</p>;
  }
  if (!ctx) {
    return <p className="mx-auto max-w-md p-6 text-sm text-muted-foreground">불러오는 중...</p>;
  }
  const isCandidate = ctx.kind === "candidate";
  const isPriorityConfirm = ctx.kind === "priority_confirm";

  // 후보자 응답은 한 번 제출하면 끝나는 화면으로 마무리한다. 면접관 쪽 응답(불가능
  // 시간 표시·우선순위 확인 모두)은 링크를 계속 재사용할 수 있어야 하므로(나중에
  // 일정이 더 생기면 같은 링크에서 다시 고쳐 제출), 화면을 끝내지 않고 배너만 보여준다.
  if (isCandidate && (ctx.status === "submitted" || done)) {
    return (
      <div className="mx-auto max-w-md p-6">
        <p className="text-lg font-semibold">
          {doneReason === "priorities-submitted" ? "희망 일정 제출이 완료되었습니다." : "제출이 완료되었습니다."}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          {doneReason === "requested-more"
            ? "다른 시간대를 다시 확인해 새로운 일정을 안내드리겠습니다. 창을 닫으셔도 됩니다."
            : doneReason === "priorities-submitted"
              ? "아직 면접 일정이 확정된 것은 아닙니다. 채용담당자가 최종 확정 후 안내드립니다."
              : "응답해주셔서 감사합니다. 창을 닫으셔도 됩니다."}
        </p>
      </div>
    );
  }

  if (ctx.kind === "reschedule_request") {
    if (ctx.status === "submitted" || done) {
      return (
        <div className="mx-auto max-w-md p-6">
          <p className="text-lg font-semibold">일정 변경 요청이 접수되었습니다.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            가능한 시간을 다시 확인해 새로운 일정을 안내드리겠습니다. 창을 닫으셔도 됩니다.
          </p>
        </div>
      );
    }
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
        <div>
          <h1 className="text-xl font-bold">{ctx.name}님, 가능한 시간을 모두 알려주세요</h1>
          <p className="text-sm text-muted-foreground">{ctx.subtitle}</p>
          <p className="text-xs text-muted-foreground">{KST_NOTICE}</p>
        </div>
        {ctx.currentSlotLabel ? (
          <p className="text-sm">
            현재 확정된 시간: <span className="font-mono font-semibold">{ctx.currentSlotLabel}</span>
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">
            이미 다른 일정 조율이 진행 중입니다. 잠시 후 새로운 안내를 받으실 수 있습니다.
          </p>
        )}
        <p className="text-sm">
          이 시간에 참석이 어려우시면, 이번 주와 다음 주 중 참석 가능한 시간을 30분 단위로 모두
          체크해주세요.
        </p>
        <p className="text-sm text-muted-foreground">
          넓게 체크해주실수록 새 일정을 더 빨리 찾을 수 있습니다. 체크하신 시간을 면접관 전원에게
          보내 참석 가능 여부를 확인한 뒤 안내드립니다.
        </p>
        <SlotGrid
          slots={ctx.slots}
          selected={rescheduleAvailable}
          onPaint={paintReschedule}
        />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={submitReschedule} disabled={submitting || !ctx.currentSlotLabel}>
          {submitting ? "처리 중..." : "제출하고 새 일정 찾기"}
        </Button>
      </div>
    );
  }

  if (ctx.kind === "candidate_wide_availability") {
    if (ctx.status === "submitted" || done) {
      return (
        <div className="mx-auto max-w-md p-6">
          <p className="text-lg font-semibold">제출이 완료되었습니다.</p>
          <p className="mt-2 text-sm text-muted-foreground">
            {doneReason === "requested-more"
              ? "체크해주신 시간을 면접관 전원에게 확인받아 새로운 일정을 안내드리겠습니다. 창을 닫으셔도 됩니다."
              : "알려주신 내용을 채용담당자에게 전달했습니다. 확인 후 다시 안내드리겠습니다. 창을 닫으셔도 됩니다."}
          </p>
        </div>
      );
    }
    return (
      <div className="mx-auto flex max-w-3xl flex-col gap-5 p-6">
        <div>
          <h1 className="text-xl font-bold">{ctx.name}님, 다음 주 가능한 시간을 알려주세요</h1>
          <p className="text-sm text-muted-foreground">{ctx.subtitle}</p>
          <p className="text-xs text-muted-foreground">{KST_NOTICE}</p>
        </div>
        <p className="text-sm">
          이번 주에 제안된 시간이 모두 어려우시다고 하셔서, 다음 주 중 참석 가능한 시간을 여쭤봅니다.
          30분 단위로 가능한 시간을 모두 체크해주세요.
        </p>
        <SlotGrid slots={ctx.slots} selected={wideAvailable} onPaint={paintWideAvailable} />
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button onClick={submitWideAvailability} disabled={submitting || wideAvailable.size === 0}>
          {submitting ? "처리 중..." : "제출하기"}
        </Button>

        <div className="rounded-md border p-3">
          {!escalateOpen ? (
            <button
              type="button"
              onClick={() => setEscalateOpen(true)}
              className="text-sm text-muted-foreground underline"
            >
              다음 주도 전부 어려우신가요?
            </button>
          ) : (
            <div className="flex flex-col gap-2.5">
              <p className="text-sm font-medium">다음 주도 참석이 어려우신 경우</p>
              <p className="text-xs text-muted-foreground">
                가능하신 시점과 사유를 알려주시면 채용담당자가 직접 확인하고 다시 안내드립니다.
              </p>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground" htmlFor="escalateDate">
                  가능하신 날짜(선택)
                </label>
                <input
                  id="escalateDate"
                  type="date"
                  value={escalateDate}
                  onChange={(e) => setEscalateDate(e.target.value)}
                  className="rounded-md border bg-background px-3 py-1.5 text-sm"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs text-muted-foreground" htmlFor="escalateReason">
                  사유(선택)
                </label>
                <textarea
                  id="escalateReason"
                  value={escalateReason}
                  onChange={(e) => setEscalateReason(e.target.value)}
                  placeholder="예: 해외 출장 중이라 8월 말부터 가능합니다."
                  className="min-h-20 rounded-md border bg-background px-3 py-1.5 text-sm"
                />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button
                variant="secondary"
                onClick={submitEscalateNote}
                disabled={submitting}
              >
                {submitting ? "처리 중..." : "이 내용으로 채용담당자에게 전달"}
              </Button>
            </div>
          )}
        </div>
      </div>
    );
  }

  if (isPriorityConfirm) {
    return (
      <div className="mx-auto flex max-w-md flex-col gap-5 p-6">
        <div>
          <h1 className="text-xl font-bold">{ctx.name}님, 최종 면접 시간을 확인해주세요</h1>
          <p className="text-sm text-muted-foreground">
            {ctx.candidateName}님({ctx.position}) 후보자가 제출한 순위입니다.
          </p>
          <p className="text-xs text-muted-foreground">{KST_NOTICE}</p>
        </div>

        <p className="text-sm">
          참석 가능한 시간을 모두 선택해주세요. 전원이 가능하다고 답한 가장 높은 순위로 자동 확정됩니다.
        </p>

        {(ctx.status === "submitted" || done) && (
          <p className="rounded-md bg-primary/10 p-2.5 text-sm text-primary">
            이미 제출하셨습니다. 이후에 일정이 바뀌면 이 링크에서 언제든 다시 고쳐 제출하실 수 있습니다.
          </p>
        )}

        <div className="flex flex-col gap-2">
          {ctx.slots.map((slot, i) => (
            <label
              key={slot.key}
              className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm has-[:checked]:border-primary has-[:checked]:bg-primary/10"
            >
              <input
                type="checkbox"
                checked={available.has(slot.key)}
                onChange={() => toggleAvailable(slot.key)}
              />
              {RANK_MEDAL[i] ?? `${i + 1}순위`} {slot.label}
            </label>
          ))}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button onClick={submitPriorityConfirm} disabled={submitting}>
          {submitting ? "처리 중..." : ctx.status === "submitted" || done ? "다시 제출하기" : "참석 여부 제출"}
        </Button>
      </div>
    );
  }

  const justRemovedKeys = new Set(justRemoved.map((s) => s.key));
  // 방금 사라진 시간도 한 번은 취소선으로 보여줘야 하니, 최신 목록에 합쳐서 그룹핑한다.
  const displaySlots = isCandidate
    ? [...ctx.slots, ...justRemoved.filter((s) => !ctx.slots.some((cs) => cs.key === s.key))]
    : ctx.slots;
  const dayGroups = isCandidate ? groupByDay(displaySlots) : [];

  return (
    <div className={`mx-auto flex flex-col gap-5 p-6 ${isCandidate ? "max-w-md" : "max-w-3xl"}`}>
      <div>
        <h1 className="text-xl font-bold">
          {ctx.name}
          {isCandidate ? "님, 면접 가능한 일정을 선택해주세요" : "님, 면접 불가능한 시간을 알려주세요"}
        </h1>
        <p className="text-sm text-muted-foreground">{ctx.subtitle}</p>
        <p className="text-xs text-muted-foreground">{KST_NOTICE}</p>
      </div>

      <p className="text-sm">
        {isCandidate
          ? "아래 일정은 면접관의 최신 가능 시간을 반영하고 있습니다. 편한 순서대로 최대 3개까지 선택해주세요(클릭한 순서가 우선순위가 됩니다)."
          : "30분 단위 표에서 불가능한(면접이 어려운) 시간대를 모두 클릭하거나 드래그해서 선택해주세요."}
      </p>

      {!isCandidate && (ctx.status === "submitted" || done) && (
        <div className="flex flex-col gap-1 rounded-md bg-primary/10 p-2.5 text-sm text-primary">
          <p>제출 완료되었습니다.</p>
          <p>
            이후에 새로 생긴 불가능한 시간이 있으면 이 링크에서 바로 추가해주세요 — 후보자가 시간을
            고를 때 자동으로 반영됩니다.
          </p>
        </div>
      )}

      {removedWhileRanked.length > 0 && (
        <div className="flex items-start justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive">
          <p>
            ⚠️ 선택하신 면접 시간이 변경되었습니다.{" "}
            {removedWhileRanked.map((s) => s.label).join(", ")}은(는) 면접관 일정 변경으로 더 이상 이용할 수
            없습니다. 다른 시간을 선택해주세요.
          </p>
          <button
            type="button"
            onClick={() => setRemovedWhileRanked([])}
            className="shrink-0 text-xs text-destructive underline"
          >
            닫기
          </button>
        </div>
      )}

      {ctx.slots.length === 0 && (
        <p className="text-sm text-destructive">
          {isCandidate ? "제안된 시간이 없습니다. 리크루터에게 문의해주세요." : "현재 제안 가능한 시간대가 없습니다."}
        </p>
      )}

      {!isCandidate && !!ctx.othersBusy?.length && (
        <p className="text-xs text-muted-foreground">
          <span className="inline-block h-3 w-3 rounded-sm border border-amber-300 bg-amber-100 align-middle" />{" "}
          주황색 칸은 이미 응답한 다른 면접관이 불가능하다고 표시한 시간입니다(참고용).
        </p>
      )}

      {isCandidate ? (
        <div className="flex flex-col gap-4">
          {dayGroups.map((group) => (
            <div key={group.dayKey} className="flex flex-col gap-1.5">
              <p className="text-sm font-semibold">{group.dayLabel}</p>
              <div className="flex flex-wrap gap-2">
                {group.slots.map((slot) => {
                  const rankIndex = selected.indexOf(slot.key);
                  const isRemoved = justRemovedKeys.has(slot.key) && !ctx.slots.some((s) => s.key === slot.key);
                  const time = slot.label.split(") ")[1] ?? slot.label;

                  if (isRemoved) {
                    return (
                      <span
                        key={slot.key}
                        title="일정 변경으로 선택할 수 없습니다"
                        className="rounded-full border border-border px-3 py-1 font-mono text-xs text-muted-foreground line-through"
                      >
                        ✕ {time}
                      </span>
                    );
                  }

                  return (
                    <button
                      key={slot.key}
                      type="button"
                      onClick={() => toggleCandidateRank(slot.key)}
                      disabled={rankIndex === -1 && selected.length >= MAX_RANKS}
                      className={`rounded-full border px-3 py-1 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
                        rankIndex !== -1
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-border text-muted-foreground"
                      }`}
                    >
                      {rankIndex !== -1 ? `${RANK_MEDAL[rankIndex]} ` : ""}
                      {time}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <SlotGrid
          slots={ctx.slots}
          selected={selectedSet}
          onPaint={paintInterviewerSlot}
          cellInfo={(key) => ({ key, warn: ctx.othersBusy?.includes(key) })}
        />
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={submit} disabled={submitting || (isCandidate && selected.length === 0)}>
        {submitting
          ? "처리 중..."
          : isCandidate
            ? "희망 일정 제출"
            : ctx.status === "submitted" || done
              ? "다시 제출하기"
              : "제출하기"}
      </Button>

      {isCandidate ? (
        <Button variant="ghost" onClick={submitAllUnavailable} disabled={submitting} className="text-muted-foreground">
          이 시간들 다 안 돼요 — 다른 시간대도 확인해주세요
        </Button>
      ) : (
        <Button
          variant="ghost"
          onClick={submitInterviewerAllUnavailable}
          disabled={submitting}
          className="text-muted-foreground"
        >
          이 기간엔 전부 안 돼요 — 다음 주도 확인해주세요
        </Button>
      )}
    </div>
  );
}
