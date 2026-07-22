"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatSlotLabel } from "@/lib/slots";

type InterviewerDetail = { id: string; name: string; role: string };

type Stage = "created" | "interviewer_pending" | "interviewer_done" | "candidate_pending" | "candidate_done";

type InterviewRow = {
  id: string;
  candidate_name: string;
  position: string;
  panelDetail: InterviewerDetail[];
  preferred_slots: string[];
  matched_slot: string | null;
  roomName: string | null;
  status: "confirmed" | "rescheduled" | "escalated" | "pending";
  stage: Stage;
  interviewerProgress: { submitted: number; total: number };
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

const STAGE_LABEL: Record<Stage, string> = {
  created: "등록됨",
  interviewer_pending: "면접관 응답 대기",
  interviewer_done: "면접관 응답 완료",
  candidate_pending: "후보자 응답 대기",
  candidate_done: "후보자 응답 완료",
};

function stageText(iv: InterviewRow) {
  if (iv.status !== "pending") return "매칭 완료";
  if (iv.stage === "interviewer_pending") {
    return `${STAGE_LABEL[iv.stage]} (${iv.interviewerProgress.submitted}/${iv.interviewerProgress.total})`;
  }
  return STAGE_LABEL[iv.stage];
}

function toCsv(rows: InterviewRow[]) {
  const header = ["후보자", "직무", "면접 패널", "진행 단계", "매칭 결과", "확정 일정"];
  const lines = rows.map((iv) => [
    iv.candidate_name,
    iv.position,
    iv.panelDetail.map((p) => p.name).join(" / "),
    stageText(iv),
    STATUS_LABEL[iv.status],
    iv.matched_slot !== null ? `${formatSlotLabel(iv.matched_slot)} · ${iv.roomName ?? ""}` : "",
  ]);
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [header, ...lines].map((row) => row.map(escape).join(",")).join("\r\n");
}

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

  function handleExportCsv() {
    if (!interviews?.length) return;
    const csv = "﻿" + toCsv(interviews);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `면접현황_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">조율 대시보드</h1>
          <p className="text-sm text-muted-foreground">
            후보자 희망시간 · 면접관 캘린더 · 회의실을 자동으로 대조해 면접 일정을 관리합니다.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportCsv} disabled={!interviews?.length}>
            CSV로 내보내기
          </Button>
          <Button asChild variant="outline">
            <Link href="/interviewers">면접관 관리</Link>
          </Button>
          <Button asChild>
            <Link href="/interviews/new">+ 후보자 등록</Link>
          </Button>
        </div>
      </div>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!interviews && !error && <p className="text-sm text-muted-foreground">불러오는 중...</p>}
      {interviews?.length === 0 && (
        <p className="text-sm text-muted-foreground">등록된 면접 케이스가 없습니다.</p>
      )}

      {!!interviews?.length && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="p-3 font-medium">후보자</th>
                <th className="p-3 font-medium">직무</th>
                <th className="p-3 font-medium">면접 패널</th>
                <th className="p-3 font-medium">진행 단계</th>
                <th className="p-3 font-medium">매칭 결과</th>
                <th className="p-3 font-medium">확정 일정</th>
                <th className="p-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {interviews?.map((iv) => (
                <tr key={iv.id} className="border-b last:border-0">
                  <td className="p-3">
                    <Link href={`/interviews/${iv.id}`} className="font-semibold hover:underline">
                      {iv.candidate_name}
                    </Link>
                  </td>
                  <td className="p-3 text-muted-foreground">{iv.position}</td>
                  <td className="p-3 text-muted-foreground">
                    {iv.panelDetail.map((p) => p.name).join(", ")}
                  </td>
                  <td className="p-3 text-muted-foreground">{stageText(iv)}</td>
                  <td className="p-3">
                    <Badge variant={STATUS_VARIANT[iv.status]}>{STATUS_LABEL[iv.status]}</Badge>
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {iv.matched_slot !== null ? `${formatSlotLabel(iv.matched_slot)} · ${iv.roomName}` : "-"}
                  </td>
                  <td className="p-3 text-right">
                    <Button size="sm" variant="ghost" onClick={() => handleDelete(iv.id)}>
                      삭제
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
