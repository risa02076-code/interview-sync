"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatSlotLabel } from "@/lib/slots";
import { deriveDisplayStatus, dDayLabel, STATUS_META, type DisplayStatus } from "@/lib/status";
import { INTERVIEW_TYPES } from "@/lib/matching";

type InterviewerDetail = { id: string; name: string; role: string; responded: boolean };

type InterviewRow = {
  id: string;
  candidate_name: string;
  position: string;
  interview_type: string;
  panelDetail: InterviewerDetail[];
  preferred_slots: string[];
  matched_slot: string | null;
  roomName: string | null;
  status: "confirmed" | "rescheduled" | "escalated" | "pending";
  stage: "created" | "interviewer_pending" | "interviewer_done" | "candidate_pending" | "candidate_done";
  interviewerProgress: { submitted: number; total: number };
  candidateResponded: boolean;
  confirmation_sent_at: string | null;
  note: string | null;
};

function locationText(iv: InterviewRow) {
  if (iv.matched_slot === null) return "-";
  return `${formatSlotLabel(iv.matched_slot)} · ${iv.roomName ?? iv.interview_type}`;
}

function toCsv(rows: InterviewRow[]) {
  const header = ["후보자", "직무", "면접 유형", "D-day", "상태", "면접관 응답", "후보자 응답", "확정 일정"];
  const lines = rows.map((iv) => {
    const ds = deriveDisplayStatus(iv);
    return [
      iv.candidate_name,
      iv.position,
      iv.interview_type,
      dDayLabel(iv.matched_slot) ?? "",
      STATUS_META[ds].label,
      `${iv.interviewerProgress.submitted}/${iv.interviewerProgress.total}`,
      iv.candidateResponded ? "완료" : "대기",
      locationText(iv),
    ];
  });
  const escape = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [header, ...lines].map((row) => row.map(escape).join(",")).join("\r\n");
}

const IN_PROGRESS_STATUSES: DisplayStatus[] = [
  "awaiting_interviewer",
  "awaiting_candidate",
  "needs_reschedule",
  "coordinated",
];

export default function InterviewsPage() {
  const [interviews, setInterviews] = useState<InterviewRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [positionFilter, setPositionFilter] = useState<string>("all");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<DisplayStatus | "all">("all");

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

  const positions = useMemo(
    () => Array.from(new Set((interviews ?? []).map((iv) => iv.position))),
    [interviews],
  );

  const stats = useMemo(() => {
    const list = interviews ?? [];
    return {
      total: list.length,
      inProgress: list.filter((iv) => IN_PROGRESS_STATUSES.includes(deriveDisplayStatus(iv))).length,
      confirmed: list.filter((iv) => deriveDisplayStatus(iv) === "confirmed").length,
      today: list.filter((iv) => dDayLabel(iv.matched_slot) === "D-0").length,
      completed: list.filter((iv) => deriveDisplayStatus(iv) === "completed").length,
    };
  }, [interviews]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (interviews ?? []).filter((iv) => {
      if (positionFilter !== "all" && iv.position !== positionFilter) return false;
      if (typeFilter !== "all" && iv.interview_type !== typeFilter) return false;
      if (statusFilter !== "all" && deriveDisplayStatus(iv) !== statusFilter) return false;
      if (q && !iv.candidate_name.toLowerCase().includes(q) && !iv.position.toLowerCase().includes(q)) {
        return false;
      }
      return true;
    });
  }, [interviews, positionFilter, typeFilter, statusFilter, search]);

  async function handleDelete(id: string) {
    if (!confirm("이 면접 케이스를 삭제할까요?")) return;
    const res = await fetch(`/api/interviews/${id}`, { method: "DELETE" });
    if (res.ok) load();
  }

  async function handleReschedule(id: string) {
    setBusyId(id);
    await fetch(`/api/interviews/${id}`, { method: "PATCH" });
    setBusyId(null);
    load();
  }

  async function handleConfirm(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/interviews/${id}/confirm`, { method: "POST" });
    setBusyId(null);
    if (!res.ok) {
      const body = await res.json();
      alert(body.error ?? "확정 메일 발송에 실패했습니다.");
      return;
    }
    load();
  }

  function handleExportCsv() {
    if (!filtered.length) return;
    const csv = "﻿" + toCsv(filtered);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `면접현황_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">조율 대시보드</h1>
          <p className="text-sm text-muted-foreground">
            후보자 희망시간 · 면접관 캘린더 · 회의실을 자동으로 대조해 면접 일정을 관리합니다.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handleExportCsv} disabled={!filtered.length}>
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

      {!!interviews?.length && (
        <div className="grid grid-cols-5 gap-3">
          <StatCard label="전체" value={stats.total} />
          <StatCard label="조율중" value={stats.inProgress} className="text-blue-700" />
          <StatCard label="확정" value={stats.confirmed} className="text-green-700" />
          <StatCard label="오늘 면접" value={stats.today} className="text-red-700" />
          <StatCard label="완료" value={stats.completed} className="text-neutral-500" />
        </div>
      )}

      {!!interviews?.length && (
        <div className="flex flex-wrap gap-3">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="🔍 후보자 이름 또는 직무 검색"
            className="max-w-xs"
          />
          <select
            value={positionFilter}
            onChange={(e) => setPositionFilter(e.target.value)}
            className="rounded-md border bg-background px-3 py-1.5 text-sm"
          >
            <option value="all">전체 직무</option>
            {positions.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className="rounded-md border bg-background px-3 py-1.5 text-sm"
          >
            <option value="all">전체 면접 유형</option>
            {INTERVIEW_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as DisplayStatus | "all")}
            className="rounded-md border bg-background px-3 py-1.5 text-sm"
          >
            <option value="all">전체 상태</option>
            {(Object.keys(STATUS_META) as DisplayStatus[]).map((k) => (
              <option key={k} value={k}>
                {STATUS_META[k].emoji} {STATUS_META[k].label}
              </option>
            ))}
          </select>
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      {!interviews && !error && <p className="text-sm text-muted-foreground">불러오는 중...</p>}
      {interviews?.length === 0 && (
        <p className="text-sm text-muted-foreground">등록된 면접 케이스가 없습니다.</p>
      )}
      {!!interviews?.length && filtered.length === 0 && (
        <p className="text-sm text-muted-foreground">조건에 맞는 케이스가 없습니다.</p>
      )}

      {!!filtered.length && (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40 text-left text-xs text-muted-foreground">
                <th className="p-3 font-medium">후보자</th>
                <th className="p-3 font-medium">직무</th>
                <th className="p-3 font-medium">면접 유형</th>
                <th className="p-3 font-medium">D-day</th>
                <th className="p-3 font-medium">상태</th>
                <th className="p-3 font-medium">면접관 응답</th>
                <th className="p-3 font-medium">후보자 응답</th>
                <th className="p-3 font-medium">확정 일정</th>
                <th className="p-3 font-medium">액션</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((iv) => {
                const ds = deriveDisplayStatus(iv);
                const meta = STATUS_META[ds];
                const dday = dDayLabel(iv.matched_slot);
                const matchingDone = iv.status !== "pending";
                return (
                  <tr key={iv.id} className="border-b last:border-0 align-top">
                    <td className="p-3">
                      <Link href={`/interviews/${iv.id}`} className="font-semibold hover:underline">
                        {iv.candidate_name}
                      </Link>
                    </td>
                    <td className="p-3 text-muted-foreground">{iv.position}</td>
                    <td className="p-3 text-muted-foreground">{iv.interview_type}</td>
                    <td className="p-3 font-mono text-xs text-muted-foreground">{dday ?? "-"}</td>
                    <td className="p-3">
                      <span
                        className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold ${meta.badgeClass}`}
                      >
                        {meta.emoji} {meta.label}
                      </span>
                    </td>
                    <td className="p-3 text-xs">
                      <div className="flex flex-col gap-0.5">
                        {iv.panelDetail.map((p) => (
                          <span key={p.id} className="text-muted-foreground">
                            {p.name} {p.responded ? "✔" : "○"}
                          </span>
                        ))}
                        <span className="mt-0.5 font-mono text-muted-foreground">
                          {iv.interviewerProgress.submitted}/{iv.interviewerProgress.total}
                        </span>
                      </div>
                    </td>
                    <td className="p-3 text-xs text-muted-foreground">
                      {iv.candidateResponded ? "● 완료" : "○ 대기"}
                    </td>
                    <td className="p-3 text-muted-foreground">{locationText(iv)}</td>
                    <td className="p-3">
                      <div className="flex flex-wrap gap-1">
                        <Button asChild size="sm" variant="outline">
                          <Link href={`/interviews/${iv.id}`}>상세보기</Link>
                        </Button>
                        {matchingDone && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={busyId === iv.id}
                            onClick={() => handleReschedule(iv.id)}
                          >
                            재조율
                          </Button>
                        )}
                        {ds === "coordinated" && (
                          <Button size="sm" disabled={busyId === iv.id} onClick={() => handleConfirm(iv.id)}>
                            확정 메일 발송
                          </Button>
                        )}
                        <Button size="sm" variant="ghost" onClick={() => handleDelete(iv.id)}>
                          삭제
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, className }: { label: string; value: number; className?: string }) {
  return (
    <div className="rounded-lg border p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 font-mono text-2xl font-bold ${className ?? ""}`}>{value}</p>
    </div>
  );
}
