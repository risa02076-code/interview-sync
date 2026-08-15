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
import { groupBusySlotsByDay, formatRespondedAt } from "@/lib/busySlots";

type PriorityConfirmRecord = {
  interviewer_id: string | null;
  status: string;
  submitted_at: string | null;
  confirm_slots: string[] | null;
  answered_slots: string[] | null;
  email_sent_at: string | null;
};
type InterviewerDetail = {
  id: string;
  name: string;
  role: string;
  responded: boolean;
  respondedAt: string | null;
  emailSentAt: string | null;
  busy_slots: string[];
  priorityConfirm: PriorityConfirmRecord | null;
};
type RoomDetail = { id: string; name: string; busy_slots: string[] };

type HistoryEntry = {
  id: string;
  kind: "interviewer" | "candidate" | "priority_confirm" | "reschedule_request";
  interviewerName: string | null;
  status: "pending" | "submitted";
  createdAt: string;
  submittedAt: string | null;
  confirmSlots: string[] | null;
  answeredSlots: string[] | null;
  answeredBusySlots: string[] | null;
  answeredPreferredSlots: string[] | null;
};

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
  history: HistoryEntry[];
};

const KIND_LABEL: Record<HistoryEntry["kind"], string> = {
  interviewer: "면접관 불가능 시간 문의",
  candidate: "후보자 희망 순위 제출 요청",
  priority_confirm: "면접관 최종 참석 확인",
  reschedule_request: "후보자 일정 변경 요청 링크",
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
  const [expandedPanelId, setExpandedPanelId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);

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

  async function handleReinviteInterviewer(interviewerId: string, name: string) {
    setBusy(true);
    const res = await fetch(`/api/interviews/${id}/reinvite-interviewer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interviewerId }),
    });
    setBusy(false);
    if (res.ok) {
      setToast(`${name}님에게 이 케이스로 다시 발송했습니다.`);
      load();
    } else {
      const body = await res.json();
      setToast(body.error ?? "재발송에 실패했습니다.");
    }
  }

  async function handleReinvitePriorityConfirm(interviewerId: string, name: string) {
    setBusy(true);
    const res = await fetch(`/api/interviews/${id}/reinvite-priority-confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interviewerId }),
    });
    setBusy(false);
    if (res.ok) {
      setToast(`${name}님에게 최종 확인 요청을 다시 보냈습니다.`);
      load();
    } else {
      const body = await res.json();
      setToast(body.error ?? "재발송에 실패했습니다.");
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
  // 후보자가 순위를 제출했으면(확정 여부와 무관하게) 누가 뭐라고 답했는지 항상 볼 수 있게 한다.
  const hasPriorities = interview.preferred_slots.length > 0;

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
          {interview.panelDetail.map((p) => {
            // 발송을 아예 시도한 적 없으면(등록 직후) 실패로 보이면 안 되니, 초대를
            // 실제로 보낸 뒤(stage가 created를 지난 뒤)에만 "이메일 자체가 안 갔다"를 오류로 본다.
            const invitesSent = interview.stage !== "created";
            const failed = invitesSent && !p.responded && !p.emailSentAt;
            return (
              <div key={p.id} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => setExpandedPanelId((cur) => (cur === p.id ? null : p.id))}
                  className="text-left"
                >
                  <Badge
                    variant="outline"
                    className={`font-normal ${failed ? "border-destructive/40 text-destructive" : ""}`}
                  >
                    {p.name} · {p.role} {p.responded ? "✔" : failed ? "⚠️" : "○"}
                    {p.responded && formatRespondedAt(p.respondedAt) && (
                      <span className="text-muted-foreground"> ({formatRespondedAt(p.respondedAt)} 응답)</span>
                    )}
                    {!p.responded && !failed && invitesSent && (
                      <span className="text-muted-foreground"> (발송됨, 응답 대기)</span>
                    )}
                    {failed && " 발송 실패"}
                  </Badge>
                </button>
                {!p.responded && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => handleReinviteInterviewer(p.id, p.name)}
                    className={`text-xs underline disabled:opacity-40 ${
                      failed ? "font-semibold text-destructive" : "text-primary"
                    }`}
                    title={
                      failed
                        ? "메일 발송이 실패한 것으로 확인됩니다 — 새 링크로 다시 보냅니다"
                        : "혹시 몰라 이 케이스에 연결된 새 링크로 다시 발송합니다"
                    }
                  >
                    재발송
                  </button>
                )}
                {failed && (
                  <Link
                    href={`/interviewers?highlight=${p.id}`}
                    className="text-xs text-destructive underline"
                    title="이메일 주소 자체가 틀렸다면 재발송해도 똑같이 실패합니다 — 먼저 여기서 고쳐주세요"
                  >
                    이메일 수정
                  </Link>
                )}
              </div>
            );
          })}
        </div>
        {expandedPanelId && (
          <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-2.5 text-xs">
            {(() => {
              const p = interview.panelDetail.find((p) => p.id === expandedPanelId)!;
              const groups = groupBusySlotsByDay(p.busy_slots);
              return (
                <>
                  <span className="font-semibold">{p.name}님이 체크한 불가능 시간</span>
                  {groups.length === 0 ? (
                    <span className="text-muted-foreground">없음 (전부 가능하다고 응답)</span>
                  ) : (
                    groups.map((group) => (
                      <div key={group.dayLabel}>
                        <span className="font-semibold">{group.dayLabel}</span>{" "}
                        <span className="text-muted-foreground">{group.times.join(", ")}</span>
                      </div>
                    ))
                  )}
                </>
              );
            })()}
          </div>
        )}
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
      ) : !hasPriorities ? (
        <p className="text-sm text-muted-foreground">희망 시간대: 미입력</p>
      ) : null}

      {hasPriorities && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <p className="text-sm font-semibold">후보자·면접관 응답 요약</p>
          {interview.status === "pending" && (
            <p className="text-xs text-muted-foreground">
              {displayStatus === "awaiting_priority_confirm"
                ? "면접관 전원에게 이 시간들 참석 가능 여부를 확인 요청했습니다. 전원 가능한 가장 높은 순위로 자동 확정됩니다. 기다리지 않고 먼저 확정하고 싶으면 아래에서 직접 눌러도 됩니다(그 자리에서 다시 검증합니다)."
                : "면접관별로 각 순위에 참석 가능한지(현재 캘린더 기준) 보여줍니다. 확정을 누르면 그 자리에서 다시 검증합니다."}
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="text-sm">
              <thead>
                <tr>
                  <th className="pb-1 pr-3 text-left text-xs font-medium text-muted-foreground">후보자 제출 순위</th>
                  {interview.panelDetail.map((p) => {
                    const pc = p.priorityConfirm;
                    // 아직 최종 확인 메일 자체를 보낸 적이 없으면(pc가 없음) 실패가 아니라 "미시작"이다.
                    const pcFailed = !!pc && pc.status !== "submitted" && !pc.email_sent_at;
                    return (
                      <th key={p.id} className="px-2 pb-1 text-xs font-medium text-muted-foreground">
                        {p.name}
                        {pc?.submitted_at && (
                          <div className="font-normal">({formatRespondedAt(pc.submitted_at)} 확인)</div>
                        )}
                        {!pc?.submitted_at && pc?.email_sent_at && (
                          <div className="font-normal text-muted-foreground">발송됨, 확인 대기</div>
                        )}
                        {pcFailed && <div className="font-normal text-destructive">⚠️ 발송 실패</div>}
                        {interview.status === "pending" && pc?.status !== "submitted" && (
                          <div>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => handleReinvitePriorityConfirm(p.id, p.name)}
                              className={`font-normal underline disabled:opacity-40 ${
                                pcFailed ? "text-destructive" : "text-primary"
                              }`}
                              title="이 순위 목록으로 최종 확인을 다시 요청합니다"
                            >
                              재발송
                            </button>
                            {pcFailed && (
                              <Link
                                href={`/interviewers?highlight=${p.id}`}
                                className="font-normal text-destructive underline"
                                title="이메일 주소 자체가 틀렸다면 재발송해도 똑같이 실패합니다 — 먼저 여기서 고쳐주세요"
                              >
                                이메일 수정
                              </Link>
                            )}
                          </div>
                        )}
                      </th>
                    );
                  })}
                  {interview.status === "pending" && <th className="pb-1" />}
                </tr>
              </thead>
              <tbody>
                {interview.preferred_slots.map((slot, i) => {
                  // 확정된 시간 그 자체는 항상 "전원 가능"으로 보여준다. 확정되는 순간
                  // 그 시간을 모든 면접관의 busy_slots에도 추가해서(다른 면접이 겹쳐
                  // 잡히지 않게) 막아두는데, 그 busy_slots를 그대로 라이브 체크에
                  // 쓰면 "방금 이 시간으로 확정했는데 이 시간이 불가능하다고" 나오는
                  // 자기참조 오류가 생긴다.
                  const isMatchedSlot = slot === interview.matched_slot;
                  return (
                    <tr key={slot} className="border-t">
                      <td className="whitespace-nowrap py-1.5 pr-3">
                        {RANK_MEDAL[i] ?? `${i + 1}순위`} {formatSlotLabel(slot)}
                      </td>
                      {interview.panelDetail.map((p) => {
                        // 이 시간에 대해 실제로 "참석 가능"이라고 확인 답변을 받은 기록이 있으면
                        // 그 기록(answered_slots)을 그대로 보여준다. 그 이후 캘린더가 또 바뀌어도
                        // 이 답변 자체는 바뀌지 않아야 하기 때문에, 라이브 busy_slots보다 우선한다.
                        const hasFrozenAnswer =
                          p.priorityConfirm?.status === "submitted" &&
                          p.priorityConfirm.confirm_slots?.includes(slot);
                        const free = isMatchedSlot
                          ? true
                          : hasFrozenAnswer
                            ? (p.priorityConfirm!.answered_slots ?? []).includes(slot)
                            : !p.busy_slots.includes(slot);
                        return (
                          <td
                            key={p.id}
                            title={
                              isMatchedSlot
                                ? "확정된 시간 — 전원 참석 가능 확인됨"
                                : hasFrozenAnswer
                                  ? "면접관이 실제로 답변한 기록"
                                  : "현재 캘린더 기준 추정"
                            }
                            className={`px-2 text-center ${free ? "text-primary" : "text-destructive"}`}
                          >
                            {free ? "✔" : "✘"}
                            {!isMatchedSlot && !hasFrozenAnswer && <span className="text-muted-foreground">*</span>}
                          </td>
                        );
                      })}
                      {interview.status === "pending" && (
                        <td className="pl-2">
                          <Button size="sm" disabled={busy} onClick={() => handleConfirmPriority(slot)}>
                            이 시간으로 확정
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            * 는 아직 실제 확인 답변이 없어 현재 캘린더 기준으로 추정한 값입니다. *가 없으면 면접관이
            그 순간에 실제로 &ldquo;가능/불가능&rdquo;이라고 답한 기록입니다.
          </p>
        </div>
      )}

      {interview.history.length > 0 && (
        <div className="flex flex-col gap-2 rounded-md border p-3">
          <button
            type="button"
            onClick={() => setHistoryOpen((v) => !v)}
            className="text-left text-sm font-semibold"
          >
            전체 응답 히스토리 ({interview.history.length}건) {historyOpen ? "숨기기 ▲" : "보기 ▼"}
          </button>
          <p className="text-xs text-muted-foreground">
            면접관이 언제 무엇을 답했는지, 후보자가 순위를 어떻게 제출했는지, 재조율 요청이
            있었는지를 시간순으로 모두 보여줍니다.
          </p>
          {historyOpen && (
            <div className="flex flex-col gap-2">
              {interview.history.map((h) => {
                const created = formatRespondedAt(h.createdAt);
                const submitted = h.submittedAt ? formatRespondedAt(h.submittedAt) : null;
                const isExpanded = expandedHistoryId === h.id;
                const detailSlots =
                  h.kind === "interviewer"
                    ? h.answeredBusySlots
                    : h.kind === "candidate"
                      ? h.answeredPreferredSlots
                      : h.kind === "priority_confirm"
                        ? h.answeredSlots
                        : null;
                const detailNoun =
                  h.kind === "interviewer" ? "불가능" : h.kind === "priority_confirm" ? "참석 가능" : "제출 순위";

                return (
                  <div key={h.id} className="rounded-md bg-muted/40 p-2.5 text-xs">
                    <p className="font-semibold">
                      {h.interviewerName ? `${h.interviewerName}님` : "후보자"} — {KIND_LABEL[h.kind]}{" "}
                      <span className="font-normal text-muted-foreground">({created} 발송)</span>
                    </p>
                    {h.kind === "priority_confirm" && !!h.confirmSlots?.length && (
                      <p className="mt-0.5 text-muted-foreground">
                        물어본 시간: {h.confirmSlots.map((s) => formatSlotLabel(s)).join(", ")}
                      </p>
                    )}
                    {h.status === "submitted" ? (
                      <p className="mt-0.5">
                        → {submitted} 응답
                        {detailSlots !== null && (
                          <>
                            : {detailNoun} {detailSlots.length}개
                            {detailSlots.length > 0 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setExpandedHistoryId((cur) => (cur === h.id ? null : h.id))
                                }
                                className="ml-1 text-primary underline"
                              >
                                {isExpanded ? "숨기기" : "보기"}
                              </button>
                            )}
                          </>
                        )}
                        {detailSlots === null && h.kind !== "reschedule_request" && (
                          <span className="text-muted-foreground"> (세부 기록 없음 — 이 기능 추가 이전 응답)</span>
                        )}
                      </p>
                    ) : (
                      <p className="mt-0.5 text-muted-foreground">→ 아직 응답 없음</p>
                    )}
                    {isExpanded && !!detailSlots?.length && (
                      <div className="mt-1.5 flex flex-col gap-1 text-muted-foreground">
                        {h.kind === "interviewer" ? (
                          groupBusySlotsByDay(detailSlots).map((group) => (
                            <div key={group.dayLabel}>
                              <span className="font-semibold text-foreground">{group.dayLabel}</span>{" "}
                              {group.times.join(", ")}
                            </div>
                          ))
                        ) : (
                          <span>{detailSlots.map((s) => formatSlotLabel(s)).join(", ")}</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {interview.note && (
        <p
          className={`text-sm ${
            interview.status === "escalated" || interview.note.includes("⚠️")
              ? "text-destructive"
              : "text-muted-foreground"
          }`}
        >
          {interview.note}
        </p>
      )}
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
