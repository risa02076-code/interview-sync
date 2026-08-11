"use client";

import { useEffect, useState, useCallback, useMemo, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatSlotLabel } from "@/lib/slots";
import { deriveDisplayStatus, dDayLabel, STATUS_META } from "@/lib/status";
import { requiresRoom } from "@/lib/matching";
import { SlotGrid, type GridSlot } from "@/components/slot-grid";

type InterviewerDetail = {
  id: string;
  name: string;
  role: string;
  responded: boolean;
  busy_slots: string[];
};
type RoomDetail = { id: string; name: string; busy_slots: string[] };

type Stage =
  | "created"
  | "interviewer_pending"
  | "interviewer_done"
  | "candidate_pending"
  | "candidate_done"
  | "priority_confirm_pending";

type InterviewDetail = {
  id: string;
  candidate_name: string;
  candidate_email: string | null;
  position: string;
  interview_type: string;
  panelDetail: InterviewerDetail[];
  rooms: RoomDetail[];
  preferred_slots: string[];
  matched_slot: string | null;
  roomName: string | null;
  status: "confirmed" | "rescheduled" | "escalated" | "pending";
  stage: Stage;
  interviewerProgress: { submitted: number; total: number };
  confirmation_sent_at: string | null;
  note: string | null;
};

const RANK_MEDAL = ["🥇", "🥈", "🥉"];

const STAGE_LABEL: Record<Stage, string> = {
  created: "등록됨 — 면접관 문의 전",
  interviewer_pending: "면접관 응답 대기 중",
  interviewer_done: "면접관 응답 완료 — 후보자 발송 가능",
  candidate_pending: "후보자 응답 대기 중",
  candidate_done: "후보자 응답 완료",
  priority_confirm_pending: "면접관 전원에게 최종 확인 중",
};

export default function InterviewDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [interview, setInterview] = useState<InterviewDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const [allSlots, setAllSlots] = useState<GridSlot[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSlot, setManualSlot] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/interviews/${id}`);
    if (res.ok) setInterview(await res.json());
  }, [id]);

  useEffect(() => {
    load();
    fetch("/api/slots")
      .then((res) => res.json())
      .then(setAllSlots);
  }, [load]);

  const needsRoom = interview ? requiresRoom(interview.interview_type) : false;

  /** 히트맵 색을 위해, 각 슬롯에 걸리는 "충돌 인원 수"를 미리 계산해둔다(면접관 겹침 + 회의실 부족). */
  const conflictBySlot = useMemo(() => {
    if (!interview) return new Map<string, number>();
    const map = new Map<string, number>();
    for (const slot of allSlots) {
      const busyPanel = interview.panelDetail.filter((p) => p.busy_slots.includes(slot.key)).length;
      const roomBlocked = needsRoom && !interview.rooms.some((r) => !r.busy_slots.includes(slot.key));
      map.set(slot.key, busyPanel + (roomBlocked ? 1 : 0));
    }
    return map;
  }, [interview, allSlots, needsRoom]);

  /**
   * 클릭한 슬롯 하나에 대해 "면접관별 가능 여부"와 "회의실 가능 여부"를 따로 보여주기
   * 위한 상세 정보. 히트맵 색(총 충돌 수)만으로는 사람 문제인지 회의실 문제인지
   * 구분이 안 돼서, 자동 매칭이 왜 그 시간을 걸렀는지(또는 골랐는지) 설명하는 용도로도 쓴다.
   */
  function slotDetail(slot: string) {
    if (!interview) return null;
    const people = interview.panelDetail.map((p) => ({
      name: p.name,
      free: !p.busy_slots.includes(slot),
    }));
    const freeRoom = interview.rooms.find((r) => !r.busy_slots.includes(slot));
    return { people, needsRoom, freeRoomName: freeRoom?.name ?? null };
  }

  async function handleManualConfirm() {
    if (!manualSlot) return;
    setBusy(true);
    const res = await fetch(`/api/interviews/${id}/manual-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot: manualSlot }),
    });
    setBusy(false);
    if (res.ok) {
      setToast("직접 선택한 시간으로 확정했습니다.");
      setManualOpen(false);
      setManualSlot(null);
      load();
    } else {
      const body = await res.json();
      setToast(body.error ?? "확정에 실패했습니다.");
    }
  }

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

  async function handleConfirmPriority(slot: string) {
    setBusy(true);
    const res = await fetch(`/api/interviews/${id}/confirm-priority`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot }),
    });
    setBusy(false);
    if (res.ok) {
      setToast("선택하신 시간으로 확정하고 확정 메일을 발송했습니다.");
      load();
    } else {
      const body = await res.json();
      setToast(body.error ?? "확정에 실패했습니다.");
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
  // 후보자가 순위를 제출한 뒤부터는(자동 확인이 진행 중이든 아니든) 리크루터가 언제든
  // 직접 그중 하나를 눌러 먼저 확정할 수 있게 열어둔다.
  const showPriorityPanel = interview.status === "pending" && interview.preferred_slots.length > 0;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <Link href="/interviews" className="text-sm text-muted-foreground hover:underline">
        ← 대시보드로
      </Link>

      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">{interview.candidate_name}</h1>
          <p className="text-sm text-muted-foreground">
            {interview.position} · {interview.interview_type}
          </p>
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
          {formatSlotLabel(interview.matched_slot!)} · {interview.roomName ?? interview.interview_type}
        </p>
      ) : !showPriorityPanel ? (
        <p className="text-sm text-muted-foreground">
          희망 시간대:{" "}
          {interview.preferred_slots.map((s) => formatSlotLabel(s)).join(", ") || "미입력"}
        </p>
      ) : null}

      {showPriorityPanel && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <p className="text-sm font-semibold">후보자가 제출한 우선순위</p>
          <p className="text-xs text-muted-foreground">
            {displayStatus === "awaiting_priority_confirm"
              ? "면접관 전원에게 이 시간들 참석 가능 여부를 확인 요청했습니다. 전원 가능한 가장 높은 순위로 자동 확정됩니다. 기다리지 않고 먼저 확정하고 싶으면 아래에서 직접 눌러도 됩니다(그 자리에서 다시 검증합니다)."
              : "확정을 누르면 그 자리에서 지금도 비어있는지 다시 확인합니다. 이미 지나간 시간이면 다른 순위를 눌러주세요."}
          </p>
          <div className="flex flex-col gap-1.5">
            {interview.preferred_slots.map((slot, i) => (
              <div key={slot} className="flex items-center justify-between rounded-md border px-3 py-2">
                <span className="text-sm">
                  {RANK_MEDAL[i] ?? `${i + 1}순위`} {formatSlotLabel(slot)}
                </span>
                <Button size="sm" disabled={busy} onClick={() => handleConfirmPriority(slot)}>
                  이 시간으로 확정
                </Button>
              </div>
            ))}
          </div>
        </div>
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
        <Button variant="outline" onClick={() => setManualOpen((v) => !v)}>
          {manualOpen ? "직접 확정 닫기" : "직접 시간 확정"}
        </Button>
        <Button onClick={handleDelete} variant="ghost">
          삭제
        </Button>
      </div>

      {manualOpen && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <p className="text-xs text-muted-foreground">
            자동 매칭이 안 되거나(전원 공통 시간 없음) 그냥 직접 정하고 싶을 때 씁니다. 색이
            진할수록 겹치는 면접관(또는 회의실 부족)이 많다는 뜻이고, 시간을 클릭하면 자동
            매칭이 그 시간을 왜 골랐는지/걸렀는지(누가 가능한지, 회의실이 있는지)를 그대로
            보여줍니다. 그대로 확정하고 싶으면 아래 버튼을 누르면 됩니다.
          </p>
          <SlotGrid
            slots={allSlots}
            selected={manualSlot ? new Set([manualSlot]) : new Set()}
            onPaint={(key) => setManualSlot(key)}
            allowDrag={false}
            panelSize={interview.panelDetail.length + (needsRoom ? 1 : 0)}
            cellInfo={(key) => ({ key, conflictCount: conflictBySlot.get(key) ?? 0 })}
          />
          {manualSlot && (
            <div className="flex flex-col gap-1.5 rounded-md bg-muted/50 p-2.5">
              <p className="text-xs font-semibold">
                선택한 시간: <span className="font-mono font-normal">{formatSlotLabel(manualSlot)}</span>
              </p>
              <div className="flex flex-wrap gap-1.5">
                {slotDetail(manualSlot)!.people.map((p) => (
                  <Badge
                    key={p.name}
                    variant="outline"
                    className={`font-normal ${p.free ? "" : "border-destructive/40 text-destructive"}`}
                  >
                    {p.name} {p.free ? "✔ 가능" : "✘ 불가능"}
                  </Badge>
                ))}
              </div>
              <p className="text-xs">
                {needsRoom ? (
                  slotDetail(manualSlot)!.freeRoomName ? (
                    <>회의실: ✔ {slotDetail(manualSlot)!.freeRoomName} 배정 가능</>
                  ) : (
                    <span className="text-destructive">회의실: ✘ 전체 회의실 사용 중</span>
                  )
                ) : (
                  "회의실: 필요 없음 (온라인/전화)"
                )}
              </p>
            </div>
          )}
          <div className="flex justify-end">
            <Button size="sm" disabled={!manualSlot || busy} onClick={handleManualConfirm}>
              {busy ? "확정 중..." : "이 시간으로 확정"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
