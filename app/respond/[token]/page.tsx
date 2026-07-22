"use client";

import { useEffect, useState, use } from "react";
import { Button } from "@/components/ui/button";

type Slot = { key: string; label: string };

type Context = {
  kind: "candidate" | "interviewer";
  status: "pending" | "submitted";
  name: string;
  subtitle: string;
  slots: Slot[];
};

export default function RespondPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [ctx, setCtx] = useState<Context | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    fetch(`/api/respond/${token}`)
      .then(async (res) => {
        if (!res.ok) throw new Error((await res.json()).error);
        return res.json();
      })
      .then(setCtx)
      .catch((e) => setError(e.message));
  }, [token]);

  function toggle(key: string) {
    setSelected((cur) => (cur.includes(key) ? cur.filter((s) => s !== key) : [...cur, key]));
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
          응답해주셔서 감사합니다. 창을 닫으셔도 됩니다.
        </p>
      </div>
    );
  }

  const isCandidate = ctx.kind === "candidate";

  return (
    <div className="mx-auto flex max-w-md flex-col gap-5 p-6">
      <div>
        <h1 className="text-xl font-bold">
          {ctx.name}
          {isCandidate ? "님, 면접 가능 시간을 알려주세요" : "님, 면접 불가능한 시간을 알려주세요"}
        </h1>
        <p className="text-sm text-muted-foreground">{ctx.subtitle}</p>
      </div>

      <p className="text-sm">
        {isCandidate
          ? "가능한 시간대를 모두 선택해주세요."
          : "불가능한(면접이 어려운) 시간대를 모두 선택해주세요."}
      </p>

      {ctx.slots.length === 0 && (
        <p className="text-sm text-destructive">현재 제안 가능한 시간대가 없습니다.</p>
      )}

      <div className="flex flex-wrap gap-2">
        {ctx.slots.map((slot) => (
          <button
            key={slot.key}
            type="button"
            onClick={() => toggle(slot.key)}
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

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={submit} disabled={submitting || selected.length === 0}>
        {submitting ? "제출 중..." : "제출하기"}
      </Button>
    </div>
  );
}
