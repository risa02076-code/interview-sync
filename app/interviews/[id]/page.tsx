"use client";

import { useEffect, useState, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SLOT_LABELS } from "@/lib/matching";

type InterviewerDetail = { id: string; name: string; role: string };

type InterviewDetail = {
  id: string;
  candidate_name: string;
  position: string;
  panelDetail: InterviewerDetail[];
  preferred_slots: number[];
  matched_slot: number | null;
  roomName: string | null;
  status: "confirmed" | "rescheduled" | "escalated" | "pending";
  note: string | null;
};

const STATUS_LABEL: Record<InterviewDetail["status"], string> = {
  confirmed: "확정",
  rescheduled: "재조율됨",
  escalated: "에스컬레이션",
  pending: "응답 대기",
};

export default function InterviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [interview, setInterview] = useState<InterviewDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    const res = await fetch(`/api/interviews/${id}`);
    if (res.ok) setInterview(await res.json());
  }

  useEffect(() => {
    load();
  }, [id]);

  async function handleReschedule() {
    setBusy(true);
    const res = await fetch(`/api/interviews/${id}`, { method: "PATCH" });
    setBusy(false);
    if (res.ok) {
      const updated = await res.json();
      setToast(
        updated.status === "rescheduled"
          ? "면접관 일정 변경을 감지해 자동으로 재조율했습니다."
          : "대체 일정을 찾지 못해 에스컬레이션되었습니다.",
      );
      load();
    }
  }

  async function handleDelete() {
    if (!confirm("이 면접 케이스를 삭제할까요?")) return;
    const res = await fetch(`/api/interviews/${id}`, { method: "DELETE" });
    if (res.ok) router.push("/interviews");
  }

  if (!interview) {
    return <p className="p-6 text-sm text-muted-foreground">불러오는 중...</p>;
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <Link href="/interviews" className="text-sm text-muted-foreground hover:underline">
        ← 대시보드로
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{interview.candidate_name}</h1>
          <p className="text-sm text-muted-foreground">{interview.position}</p>
        </div>
        <Badge>{STATUS_LABEL[interview.status]}</Badge>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-semibold">면접 패널</p>
        <div className="flex flex-wrap gap-1.5">
          {interview.panelDetail.map((p) => (
            <Badge key={p.id} variant="outline" className="font-normal">
              {p.name} · {p.role}
            </Badge>
          ))}
        </div>
      </div>

      {interview.status === "confirmed" || interview.status === "rescheduled" ? (
        <p className="text-sm">
          <span className="font-semibold">확정 일정: </span>
          {SLOT_LABELS[interview.matched_slot!]} · {interview.roomName}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          희망 시간대: {interview.preferred_slots.map((s) => SLOT_LABELS[s]).join(", ") || "미입력"}
        </p>
      )}

      {interview.note && <p className="text-sm text-destructive">{interview.note}</p>}
      {toast && <p className="text-sm text-primary">{toast}</p>}

      <div className="flex gap-2">
        {(interview.status === "confirmed" || interview.status === "rescheduled") && (
          <Button onClick={handleReschedule} disabled={busy} variant="secondary">
            {busy ? "재조율 중..." : "면접관 일정 변경 시뮬레이션"}
          </Button>
        )}
        <Button onClick={handleDelete} variant="ghost">
          삭제
        </Button>
      </div>
    </div>
  );
}
