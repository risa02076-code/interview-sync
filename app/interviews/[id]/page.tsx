"use client";

import { useEffect, useState, useCallback, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatSlotLabel } from "@/lib/slots";
import { deriveDisplayStatus, dDayLabel, STATUS_META } from "@/lib/status";

type InterviewerDetail = { id: string; name: string; role: string; responded: boolean };

type Stage = "created" | "interviewer_pending" | "interviewer_done" | "candidate_pending" | "candidate_done";

type InterviewDetail = {
  id: string;
  candidate_name: string;
  candidate_email: string | null;
  position: string;
  panelDetail: InterviewerDetail[];
  preferred_slots: string[];
  matched_slot: string | null;
  roomName: string | null;
  status: "confirmed" | "rescheduled" | "escalated" | "pending";
  stage: Stage;
  interviewerProgress: { submitted: number; total: number };
  confirmation_sent_at: string | null;
  note: string | null;
};

const STAGE_LABEL: Record<Stage, string> = {
  created: "등록됨 — 면접관 문의 전",
  interviewer_pending: "면접관 응답 대기 중",
  interviewer_done: "면접관 응답 완료 — 후보자 발송 가능",
  candidate_pending: "후보자 응답 대기 중",
  candidate_done: "후보자 응답 완료",
};

export default function InterviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [interview, setInterview] = useState<InterviewDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/interviews/${id}`);
    if (res.ok) setInterview(await res.json());
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleInviteInterviewers() {
    setInviting(true);
    const res = await fetch(`/api/interviews/${id}/invite-interviewers`, { method: "POST" });
    setInviting(false);
    if (res.ok) {
      const body = await res.json();
      setToast(`면접관 ${body.sent}명에게 가능 시간 문의 메일을 보냈습니다.`);
      load();
    } else {
      const body = await res.json();
      setToast(body.error ?? "이메일 발송에 실패했습니다.");
    }
  }

  async function handleInviteCandidate() {
    setInviting(true);
    const res = await fetch(`/api/interviews/${id}/invite`, { method: "POST" });
    setInviting(false);
    if (res.ok) {
      setToast("후보자에게 희망시간 문의 이메일을 보냈습니다.");
      load();
    } else {
      const body = await res.json();
      setToast(body.error ?? "이메일 발송에 실패했습니다.");
    }
  }

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

  async function handleConfirm() {
    setBusy(true);
    const res = await fetch(`/api/interviews/${id}/confirm`, { method: "POST" });
    setBusy(false);
    if (res.ok) {
      setToast("후보자·면접관 전원에게 확정 메일을 발송했습니다.");
      load();
    } else {
      const body = await res.json();
      setToast(body.error ?? "확정 메일 발송에 실패했습니다.");
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

  const matchingDone = interview.status !== "pending";
  const displayStatus = deriveDisplayStatus(interview);
  const meta = STATUS_META[displayStatus];
  const dday = dDayLabel(interview.matched_slot);

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
        <div className="flex flex-col items-end gap-1.5">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.badgeClass}`}
          >
            {meta.emoji} {meta.label}
          </span>
          {dday && <span className="font-mono text-xs text-muted-foreground">{dday}</span>}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-sm font-semibold">면접 패널 응답 현황</p>
        <div className="flex flex-wrap gap-1.5">
          {interview.panelDetail.map((p) => (
            <Badge key={p.id} variant="outline" className="font-normal">
              {p.name} · {p.role} {p.responded ? "✔" : "○"}
            </Badge>
          ))}
        </div>
      </div>

      {!matchingDone && (
        <p className="text-sm">
          <span className="font-semibold">진행 단계: </span>
          {STAGE_LABEL[interview.stage]}
          {interview.stage === "interviewer_pending" &&
            ` (${interview.interviewerProgress.submitted}/${interview.interviewerProgress.total})`}
        </p>
      )}

      {interview.status === "confirmed" || interview.status === "rescheduled" ? (
        <p className="text-sm">
          <span className="font-semibold">확정 일정: </span>
          {formatSlotLabel(interview.matched_slot!)} · {interview.roomName}
        </p>
      ) : (
        <p className="text-sm text-muted-foreground">
          희망 시간대:{" "}
          {interview.preferred_slots.map((s) => formatSlotLabel(s)).join(", ") || "미입력"}
        </p>
      )}

      {interview.note && <p className="text-sm text-destructive">{interview.note}</p>}
      {toast && <p className="text-sm text-primary">{toast}</p>}

      <div className="flex flex-wrap gap-2">
        {(interview.status === "confirmed" || interview.status === "rescheduled") && (
          <Button onClick={handleReschedule} disabled={busy} variant="secondary">
            {busy ? "재조율 중..." : "재조율"}
          </Button>
        )}
        {displayStatus === "coordinated" && (
          <Button onClick={handleConfirm} disabled={busy}>
            {busy ? "발송 중..." : "확정 메일 발송"}
          </Button>
        )}
        {!matchingDone && interview.stage === "created" && (
          <Button onClick={handleInviteInterviewers} disabled={inviting} variant="secondary">
            {inviting ? "발송 중..." : "① 면접관에게 가능 시간 문의 보내기"}
          </Button>
        )}
        {!matchingDone && interview.stage === "interviewer_pending" && (
          <Button disabled variant="secondary">
            면접관 응답 대기 중 ({interview.interviewerProgress.submitted}/{interview.interviewerProgress.total})
          </Button>
        )}
        {!matchingDone && interview.stage === "interviewer_done" && interview.candidate_email && (
          <Button onClick={handleInviteCandidate} disabled={inviting} variant="secondary">
            {inviting ? "발송 중..." : "② 후보자에게 이메일 발송"}
          </Button>
        )}
        {!matchingDone && interview.stage === "candidate_pending" && (
          <Button disabled variant="secondary">
            후보자 응답 대기 중
          </Button>
        )}
        <Button onClick={handleDelete} variant="ghost">
          삭제
        </Button>
      </div>
    </div>
  );
}
