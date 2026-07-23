"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { formatSlotLabel } from "@/lib/slots";
import { deriveDisplayStatus, STATUS_META } from "@/lib/status";
import { type InterviewRow } from "./types";

export function EventDrawer({
  interview,
  busy,
  onClose,
  onReschedule,
  onConfirm,
}: {
  interview: InterviewRow;
  busy: boolean;
  onClose: () => void;
  onReschedule: (id: string) => void;
  onConfirm: (id: string) => void;
}) {
  const ds = deriveDisplayStatus(interview);
  const meta = STATUS_META[ds];
  const matchingDone = interview.status !== "pending";
  const teamsLink =
    interview.interview_type === "온라인" ? "연동 예정 (Microsoft Graph API 필요)" : "-";

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        aria-label="닫기"
        className="absolute inset-0 bg-black/30"
        onClick={onClose}
      />
      <div className="relative flex h-full w-full max-w-sm flex-col gap-5 overflow-y-auto border-l bg-white p-6 shadow-xl">
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-bold">{interview.candidate_name}</h2>
            <p className="text-sm text-muted-foreground">{interview.position}</p>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        <span
          className={`inline-flex w-fit items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${meta.badgeClass}`}
        >
          {meta.emoji} {meta.label}
        </span>

        <dl className="flex flex-col gap-3 text-sm">
          <Row label="면접관">
            {interview.panelDetail.map((p) => `${p.name}(${p.responded ? "✔" : "○"})`).join(", ")}
          </Row>
          <Row label="면접 방식">{interview.interview_type}</Row>
          <Row label="회의실">{interview.roomName ?? "-"}</Row>
          <Row label="Teams 링크">{teamsLink}</Row>
          <Row label="일정">
            {interview.matched_slot ? formatSlotLabel(interview.matched_slot) : "미확정"}
          </Row>
          <Row label="연락처">{interview.candidate_email ?? "-"}</Row>
          <Row label="메모">{interview.note ?? "-"}</Row>
        </dl>

        <div className="mt-auto flex flex-col gap-2">
          {matchingDone && (
            <Button variant="secondary" disabled={busy} onClick={() => onReschedule(interview.id)}>
              재조율
            </Button>
          )}
          {ds === "coordinated" && (
            <Button disabled={busy} onClick={() => onConfirm(interview.id)}>
              확정 메일 발송
            </Button>
          )}
          <Button asChild variant="ghost">
            <Link href={`/interviews/${interview.id}`}>전체 상세 페이지 열기</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 border-b pb-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
