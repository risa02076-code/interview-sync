"use client";

import { useEffect, useState, useCallback, useMemo, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatSlotLabel, formatSlotRangeLabel, interviewDurationMinutes } from "@/lib/slots";
import { deriveDisplayStatus, dDayLabel, STATUS_META } from "@/lib/status";
import { requiresRoom } from "@/lib/matching";
import { SlotGrid, type GridSlot } from "@/components/slot-grid";
import { buildResponseMatrix, heatInputs, type SlotState } from "@/lib/responseMatrix";
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
  emailSentAt: string | null;
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

/**
 * 응답 현황을 다시 읽어오는 주기.
 *
 * Supabase Realtime을 쓰지 않는다. 테이블별로 Realtime을 켜고 RLS까지 맞춰야 하고,
 * 구독 확인 직후의 변경이 유실되는 경쟁 조건과 라우트 이동 시 옛 채널이 남는 문제가
 * 알려져 있다. 이 화면은 담당자만 보고 응답은 분 단위로 들어오므로, 실패해도 다음
 * 주기에 저절로 복구되는 폴링이 더 적합하다(응답 화면도 같은 방식을 쓴다).
 *
 * 갱신 경로를 load() 하나로만 두었으니, 나중에 Realtime으로 갈아끼울 때 이 훅만
 * 바꾸면 된다.
 */
const REFRESH_MS = 15_000;

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
  // 정합성 검사가 발송을 보류했을 때만 채워진다. 보류는 "실패"가 아니라 사람의
  // 판단을 기다리는 상태라, 이유를 그대로 보여주고 강제 발송 버튼을 함께 띄운다.
  // slot이 있으면 순위 확정 경로, 없으면 확정 메일 발송 버튼 경로다.
  const [held, setHeld] = useState<{ reason: string; slot: string | null } | null>(null);

  const [allSlots, setAllSlots] = useState<GridSlot[]>([]);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualSlot, setManualSlot] = useState<string | null>(null);
  const [expandedPanelId, setExpandedPanelId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  // 히트맵에서 눌러 본 슬롯. 폴링으로 데이터가 갱신돼도 펼친 상태가 리셋되지 않도록 키로 들고 있는다.
  const [inspectedSlot, setInspectedSlot] = useState<string | null>(null);
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

  // 후보자·면접관이 응답을 업데이트하면 히트맵도 따라가야 한다. 펼쳐 본 슬롯은
  // 키(inspectedSlot)로 들고 있으므로 갱신돼도 열린 상태가 유지된다.
  useEffect(() => {
    const timer = setInterval(() => {
      // 다른 탭을 보고 있는 동안은 불필요한 조회를 하지 않는다.
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
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

  const durationMinutes = interview ? interviewDurationMinutes(interview.interview_type) : 30;

  /**
   * 응답 현황 히트맵의 원본. 계산은 lib/responseMatrix.ts의 순수 함수가 하고,
   * 여기서는 화면에 있는 데이터를 그 입력 형태로 옮기기만 한다.
   */
  const matrix = useMemo(() => {
    if (!interview) return null;
    // /api/slots는 지금 기준 앞으로의 영업일만 만든다 — 지난 라운드에 답한 시간이
    // 격자에서 잘리지 않도록 히스토리에 등장한 슬롯을 모두 모아 축에 넣는다.
    const historySlots = interview.history.flatMap((h) => [
      ...(h.confirmSlots ?? []),
      ...(h.answeredSlots ?? []),
      ...(h.answeredBusySlots ?? []),
      ...(h.answeredPreferredSlots ?? []),
    ]);
    return buildResponseMatrix({
      interviewers: interview.panelDetail.map((p) => ({
        id: p.id,
        name: p.name,
        responded: p.responded,
        busy_slots: p.busy_slots,
        // 확정된 시간에 대해 "참석 가능"이라고 직접 답한 기록. 이게 있으면 확정
        // 구간의 busy_slots 항목이 본인 사정인지 이 면접 때문인지 모호하지 않다.
        attendanceConfirmedStarts: p.priorityConfirm?.answered_slots ?? [],
      })),
      rooms: interview.rooms,
      preferredSlots: interview.preferred_slots ?? [],
      matchedSlot: interview.matched_slot,
      gridSlots: allSlots.map((s) => s.key),
      historySlots,
      needsRoom,
      durationMinutes,
    });
  }, [interview, allSlots, needsRoom, durationMinutes]);

  const inspected: SlotState | null =
    inspectedSlot && matrix ? matrix.states.get(inspectedSlot) ?? null : null;

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

  async function handleConfirm(force = false) {
    setBusy(true);
    const res = await fetch(`/api/interviews/${id}/confirm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force }),
    });
    setBusy(false);
    if (res.ok) {
      setHeld(null);
      setToast(
        force
          ? "정합성 오류를 확인한 뒤 그대로 발송했습니다."
          : "후보자·면접관 전원에게 확정 메일을 발송했습니다.",
      );
      load();
    } else {
      const body = await res.json();
      const message = body.error ?? "확정 메일 발송에 실패했습니다.";
      setHeld(body.held ? { reason: message, slot: null } : null);
      setToast(body.held ? null : message);
      // 보류 사유는 note에도 남으므로 화면을 다시 읽어 최신 상태를 보여준다.
      if (body.held) load();
    }
  }

  async function handleConfirmPriority(slot: string, force = false) {
    setBusy(true);
    const res = await fetch(`/api/interviews/${id}/confirm-priority`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slot, force }),
    });
    setBusy(false);
    const body = await res.json();
    if (!res.ok) {
      setToast(body.error ?? "확정에 실패했습니다.");
      return;
    }
    // 확정은 됐지만 메일이 보류될 수 있다 — 둘을 구분해서 알린다.
    if (body.mail?.ok) {
      setHeld(null);
      setToast("선택하신 시간으로 확정하고 확정 메일을 발송했습니다.");
    } else if (body.mail?.held) {
      setHeld({ reason: body.mail.error, slot });
      setToast(null);
    } else {
      setToast(`확정은 됐지만 메일 발송에 실패했습니다: ${body.mail?.error ?? "알 수 없는 오류"}`);
    }
    load();
  }

  // 보류 사유를 확인한 담당자가 그대로 발송하겠다고 결정했을 때. 되돌릴 수 없는
  // 발송이라 한 번 더 묻는다(삭제와 같은 방식).
  async function handleForceSend() {
    if (!held) return;
    if (!confirm("정합성 오류가 있는 상태로 확정 메일을 발송합니다. 발송 후에는 되돌릴 수 없습니다. 계속할까요?")) {
      return;
    }
    if (held.slot) {
      await handleConfirmPriority(held.slot, true);
    } else {
      await handleConfirm(true);
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

      {matrix && matrix.slots.length > 0 && (
        <div className="flex flex-col gap-3 rounded-md border p-3">
          <div>
            <p className="text-sm font-semibold">응답 현황 히트맵</p>
            <p className="text-xs text-muted-foreground">
              면접관 응답 {interview.interviewerProgress.submitted}/
              {interview.interviewerProgress.total} · 면접 소요시간 {durationMinutes}분 기준 ·{" "}
              {REFRESH_MS / 1000}초마다 자동 갱신. 시간을 누르면 누가 가능한지 아래에 나옵니다.
            </p>
          </div>

          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-3 w-5 rounded-sm border"
                style={{ backgroundColor: "rgba(34,197,94,0.18)" }}
              />
              답변 기준 전원 가능
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-3 w-5 rounded-sm border"
                style={{ backgroundColor: "rgba(239,68,8,0.6)" }}
              />
              불가능하다고 답한 인원 많음
            </span>
            <span className="flex items-center gap-1">
              <span
                className="inline-block h-3 w-5 rounded-sm border"
                style={{
                  backgroundImage:
                    "repeating-linear-gradient(45deg, rgba(100,116,139,0.28) 0 2px, transparent 2px 5px)",
                }}
              />
              미응답 있음 — 추정
            </span>
            <span>확정 ● / 후보자 순위 🥇🥈🥉</span>
          </div>

          <SlotGrid
            slots={matrix.slots.map((key) => ({ key }))}
            selected={inspectedSlot ? new Set([inspectedSlot]) : new Set()}
            onPaint={(key) => setInspectedSlot((cur) => (cur === key ? null : key))}
            allowDrag={false}
            readOnly
            size="roomy"
            panelSize={interview.panelDetail.length + (needsRoom ? 1 : 0)}
            cellInfo={(key) => {
              const s = matrix.states.get(key);
              if (!s) return { key };
              const { conflictCount, estimated } = heatInputs(s);
              return {
                key,
                conflictCount,
                estimated,
                mark: s.occupiedByMatch ? "●" : s.candidateRank ? RANK_MEDAL[s.candidateRank - 1] : undefined,
                hint: [
                  s.occupiedByMatch ? "확정된 면접 시간" : null,
                  s.candidateRank ? `후보자 ${s.candidateRank}순위` : null,
                  s.unavailable.length ? `불가능 ${s.unavailable.length}명` : null,
                  s.unknown.length ? `미응답 ${s.unknown.length}명` : null,
                  needsRoom && !s.roomFree ? "회의실 없음" : null,
                ]
                  .filter(Boolean)
                  .join(" · "),
              };
            }}
          />

          {inspected ? (
            <div className="flex flex-col gap-1.5 rounded-md bg-muted/50 p-2.5 text-xs">
              <p className="text-sm font-semibold">
                <span className="font-mono font-normal">
                  {formatSlotRangeLabel(inspected.slot, durationMinutes)}
                </span>
                {inspected.isMatchedStart && <span className="ml-2 text-primary">확정된 시간</span>}
              </p>
              <p>
                <span className="text-muted-foreground">가능(답변 확인) </span>
                {inspected.available.join(", ") || "—"}
              </p>
              <p>
                <span className="text-muted-foreground">불가능(답변 확인) </span>
                <span className={inspected.unavailable.length ? "text-destructive" : undefined}>
                  {inspected.unavailable.join(", ") || "—"}
                </span>
              </p>
              <p>
                <span className="text-muted-foreground">미응답(추정) </span>
                <span className={inspected.unknown.length ? "text-amber-600" : undefined}>
                  {inspected.unknown.join(", ") || "—"}
                </span>
              </p>
              {inspected.ambiguous.length > 0 && (
                <p className="text-muted-foreground">
                  확정된 면접이 차지하는 시간이라, {inspected.ambiguous.join(", ")}님의 표시가 본인
                  사정인지 이 면접 때문인지 구분할 수 없습니다.
                </p>
              )}
              {needsRoom && (
                <p>
                  <span className="text-muted-foreground">회의실 </span>
                  {inspected.roomFree ? "사용 가능한 방 있음" : "전부 사용 중"}
                </p>
              )}
              {inspected.startable && inspected.unknown.length > 0 && (
                <p className="text-amber-600">
                  조건은 통과하지만, 아직 답하지 않은 사람이 있어 &ldquo;가능&rdquo;의 근거가
                  답변이 아니라 미응답입니다.
                </p>
              )}
              {!inspected.startable && (
                <p className="text-muted-foreground">
                  이 시간에 시작하면 {durationMinutes}분을 확보할 수 없어 자동 매칭 후보에서
                  제외됩니다.
                </p>
              )}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              시간을 누르면 그 시간의 가능·불가능·미응답 명단이 여기에 표시됩니다.
            </p>
          )}
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
            위 히트맵이 &ldquo;지금 상태&rdquo;라면, 이 기록은 &ldquo;언제 무엇을
            답했는지&rdquo;입니다. 면접관 응답, 후보자 순위 제출, 재조율 요청을 시간순으로
            모두 남깁니다.
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
                // reschedule_request는 후보자 확정 메일에 딸린 링크일 뿐 별도로 발송 성공
                // 여부를 기록하지 않으므로, 이 표시는 실제로 email_sent_at을 관리하는
                // kind에서만 "발송 실패"로 단정한다 — 안 그러면 이 kind는 항상 null이라
                // 매번 실패로 잘못 보이게 된다.
                const emailTracked = h.kind === "interviewer" || h.kind === "candidate" || h.kind === "priority_confirm";
                const sendFailed = emailTracked && !h.emailSentAt;

                return (
                  <div key={h.id} className="rounded-md bg-muted/40 p-2.5 text-xs">
                    <p className="font-semibold">
                      {h.interviewerName ? `${h.interviewerName}님` : "후보자"} — {KIND_LABEL[h.kind]}{" "}
                      <span className={`font-normal ${sendFailed ? "text-destructive" : "text-muted-foreground"}`}>
                        {sendFailed ? "(⚠️ 발송 실패)" : `(${created} 발송)`}
                      </span>
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

      {held && (
        <div className="flex flex-col gap-2 rounded-md border border-destructive p-3">
          <p className="text-sm font-medium text-destructive">확정 메일 발송을 보류했습니다</p>
          <p className="text-sm text-muted-foreground">{held.reason}</p>
          <p className="text-xs text-muted-foreground">
            이 검사는 저장된 다른 확정 건과 대조해 겹침·누락을 찾습니다. 검사 자체가 틀릴 수도
            있으니, 실제로 문제가 없다고 판단되면 그대로 발송할 수 있습니다. 발송한 메일은
            회수할 수 없습니다.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button variant="destructive" size="sm" disabled={busy} onClick={handleForceSend}>
              {busy ? "발송 중..." : "확인했습니다 — 그대로 발송"}
            </Button>
            <Button variant="outline" size="sm" disabled={busy} onClick={() => setHeld(null)}>
              닫기
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {(interview.status === "confirmed" || interview.status === "rescheduled") && (
          <Button onClick={handleReschedule} disabled={busy} variant="secondary">
            {busy ? "재조율 중..." : "재조율"}
          </Button>
        )}
        {displayStatus === "coordinated" && (
          <Button onClick={() => handleConfirm()} disabled={busy}>
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
