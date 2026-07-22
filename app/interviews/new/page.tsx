"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SLOT_LABELS } from "@/lib/matching";

type Interviewer = { id: string; name: string; role: string };

export default function NewInterviewPage() {
  const router = useRouter();
  const [interviewers, setInterviewers] = useState<Interviewer[]>([]);
  const [candidateName, setCandidateName] = useState("");
  const [position, setPosition] = useState("");
  const [panel, setPanel] = useState<string[]>([]);
  const [preferredSlots, setPreferredSlots] = useState<number[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/interviewers")
      .then((res) => res.json())
      .then(setInterviewers);
  }, []);

  function togglePanel(id: string) {
    setPanel((cur) => (cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id]));
  }

  function toggleSlot(i: number) {
    setPreferredSlots((cur) => (cur.includes(i) ? cur.filter((s) => s !== i) : [...cur, i]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!candidateName.trim() || !position.trim() || panel.length === 0) {
      setError("후보자 이름, 지원 직무, 면접 패널(1명 이상)은 필수입니다.");
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/interviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateName, position, panel, preferredSlots }),
    });
    setSubmitting(false);

    if (!res.ok) {
      const body = await res.json();
      setError(body.error ?? "등록에 실패했습니다.");
      return;
    }
    router.push("/interviews");
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">새 후보자 등록</h1>
      <p className="text-sm text-muted-foreground">
        등록하면 즉시 패널·회의실 가용 시간을 대조해 자동으로 매칭을 시도합니다.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="candidateName">후보자 이름</Label>
            <Input
              id="candidateName"
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              placeholder="예: 서지민"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="position">지원 직무</Label>
            <Input
              id="position"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="예: 프론트엔드 개발자"
            />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>면접 패널 선택 (2명 이상 권장)</Label>
          <div className="flex flex-wrap gap-2">
            {interviewers.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => togglePanel(p.id)}
                className={`rounded-full border px-3 py-1 text-sm ${
                  panel.includes(p.id)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {p.name} · {p.role}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>후보자 희망 시간대 선택</Label>
          <div className="flex flex-wrap gap-2">
            {SLOT_LABELS.map((label, i) => (
              <button
                type="button"
                key={i}
                onClick={() => toggleSlot(i)}
                className={`rounded-full border px-3 py-1 font-mono text-xs ${
                  preferredSlots.includes(i)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={() => router.push("/interviews")}>
            취소
          </Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? "매칭 중..." : "자동 매칭 실행"}
          </Button>
        </div>
      </form>
    </div>
  );
}
