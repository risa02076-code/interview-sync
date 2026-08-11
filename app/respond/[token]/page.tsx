"use client";

import { useEffect, useState, useMemo, use } from "react";
import { Button } from "@/components/ui/button";
import { SlotGrid } from "@/components/slot-grid";

type Slot = { key: string; label: string };

type Context = {
  kind: "candidate" | "interviewer";
  status: "pending" | "submitted";
  name: string;
  subtitle: string;
  slots: Slot[];
  preSelected?: string[];
  othersBusy?: string[];
};

export default function RespondPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [doneReason, setDoneReason] = useState<"confirmed" | "requested-more" | null>(null);

  useEffect(() => {
    fetch(`/api/respond/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error);
        return res.json();
      })
      .then((data: Context) => {
        setCtx(data);
        // 제안된 시간이 하나뿐이면 굳이 클릭하게 하지 않고 미리 선택해둔다.
        if (data.kind === "candidate" && data.slots.length === 1) {
          setSelected([data.slots[0].key]);
        }
        // 재문의 라운드에서는 이전에 자신이 표시했던 불가능한 시간을 그대로 이어서 보여준다.
        if (data.kind === "interviewer" && data.preSelected?.length) {
          setSelected(data.preSelected);
        }
      })
      .catch((e) => setError(e.message));
  }, [token]);

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  function selectCandidateSlot(key: string) {
    // 후보자는 추천받은 시간 중 하나만 고르는 것이므로 항상 단일 선택으로 교체한다.
    setSelected([key]);
  }

  function paintInterviewerSlot(key: string, select: boolean) {
    setSelected((cur) => {
      const set = new Set(cur);
      if (select) set.add(key);
      else set.delete(key);
      return Array.from(set);
    });
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/respond/${token}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ selectedSlots: selected }),
    });
    setSubmitting(false);
    if (!res.ok) {
      setError((await res.json()).error ?? "제출에 실패했습니다.");
      return;
    }
    setDoneReason("confirmed");
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
    setDoneReason("requested-more");
    setDone(true);
  }

  if (error) {
    return <p className="mx-auto max-w-md p-6 text-sm text-destructive">{error}</p>;
  }
  if (!ctx) {
    return <p className="mx-auto max-w-md p-6 text-sm text-muted-foreground">불러오는 중...</p>;
  }
  if (ctx.status === "submitted" || done) {
    return (
      <div className="mx-auto max-w-md p-6">
        <p className="text-lg font-semibold">제출이 완료되었습니다.</p>
        <p className="mt-2 text-sm text-muted-foreground">
          {doneReason === "requested-more"
            ? "다른 시간대를 다시 확인해 새로운 일정을 안내드리겠습니다. 창을 닫으셔도 됩니다."
            : "응답해주셔서 감사합니다. 창을 닫으셔도 됩니다."}
        </p>
      </div>
    );
  }

  const isCandidate = ctx.kind === "candidate";

  return (
    <div className={`mx-auto flex flex-col gap-5 p-6 ${isCandidate ? "max-w-md" : "max-w-3xl"}`}>
      <div>
        <h1 className="text-xl font-bold">
          {ctx.name}
          {isCandidate ? "님, 면접 일정을 제안드립니다" : "님, 면접 불가능한 시간을 알려주세요"}
        </h1>
        <p className="text-sm text-muted-foreground">{ctx.subtitle}</p>
      </div>

      <p className="text-sm">
        {isCandidate
          ? ctx.slots.length > 1
            ? "아래 제안된 시간 중 편한 시간을 선택해 확정해주세요."
            : "아래 제안된 시간을 확인 후 확정해주세요."
          : "30분 단위 표에서 불가능한(면접이 어려운) 시간대를 모두 클릭하거나 드래그해서 선택해주세요."}
      </p>

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
        <div className="flex flex-wrap gap-2">
          {ctx.slots.map((slot) => (
            <button
              key={slot.key}
              type="button"
              onClick={() => selectCandidateSlot(slot.key)}
              className={`rounded-full border px-3 py-1 font-mono text-xs ${
                selected.includes(slot.key)
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground"
              }`}
            >
              {slot.label}
            </button>
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
        {submitting ? "처리 중..." : isCandidate ? "확정하기" : "제출하기"}
      </Button>

      {isCandidate && (
        <Button variant="ghost" onClick={submitAllUnavailable} disabled={submitting} className="text-muted-foreground">
          이 시간들 다 안 돼요 — 다른 시간대도 확인해주세요
        </Button>
      )}
    </div>
  );
}
