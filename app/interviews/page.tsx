"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { SLOT_LABELS } from "@/lib/matching";

type InterviewerDetail = { id: string; name: string; role: string };

type InterviewRow = {
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

const STATUS_LABEL: Record<InterviewRow["status"], string> = {
  confirmed: "확정",
  rescheduled: "재조율됨",
  escalated: "에스컬레이션",
  pending: "응답 대기",
};

const STATUS_VARIANT: Record<InterviewRow["status"], "default" | "secondary" | "destructive" | "outline"> = {
  confirmed: "default",
  rescheduled: "secondary",
  escalated: "destructive",
  pending: "outline",
};

export default function InterviewsPage() {
  const [interviews, setInterviews] = useState<InterviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/interviews");
    if (!res.ok) {
      setError("목록을 불러오지 못했습니다.");
      return;
    }
    setInterviews(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  async function handleDelete(id: string) {
    if (!confirm("이 면접 케이스를 삭제할까요?")) return;
    const res = await fetch(`/api/interviews/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">조율 대시보드</h1>
          <p className="text-sm text-muted-foreground">
            후보자 희망시간 · 면접관 캘린더 · 회의실을 자동으로 대조해 면접 일정을 관리합니다.
          </p>
        </div>
        <Button asChild>
          <Link href="/interviews/new">+ 후보자 등록</Link>
        </Button>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!interviews && !error && <p className="text-sm text-muted-foreground">불러오는 중...</p>}
      {interviews?.length === 0 && (
        <p className="text-sm text-muted-foreground">등록된 면접 케이스가 없습니다.</p>
      )}

      <div className="flex flex-col gap-3">
        {interviews?.map((iv) => (
          <Card key={iv.id}>
            <CardContent className="flex items-start justify-between gap-4 p-4">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-baseline gap-2">
                  <Link href={`/interviews/${iv.id}`} className="font-semibold hover:underline">
                    {iv.candidate_name}
                  </Link>
                  <span className="text-sm text-muted-foreground">{iv.position}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {iv.panelDetail.map((p) => (
                    <Badge key={p.id} variant="outline" className="font-normal">
                      {p.name} · {p.role}
                    </Badge>
                  ))}
                </div>
                {iv.status === "confirmed" || iv.status === "rescheduled" ? (
                  <p className="text-sm">
                    {SLOT_LABELS[iv.matched_slot!]} · {iv.roomName}
                  </p>
                ) : iv.preferred_slots.length ? (
                  <p className="text-sm text-muted-foreground">
                    희망 시간대: {iv.preferred_slots.map((s) => SLOT_LABELS[s]).join(", ")}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">희망 시간대 미입력</p>
                )}
                {iv.note && <p className="text-xs text-destructive">{iv.note}</p>}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-2">
                <Badge variant={STATUS_VARIANT[iv.status]}>{STATUS_LABEL[iv.status]}</Badge>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(iv.id)}>
                  삭제
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
