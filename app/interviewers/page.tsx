"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { SlotGrid, type GridSlot } from "@/components/slot-grid";

type InterviewerRow = {
  id: string;
  name: string;
  role: string;
  email: string | null;
  busy_slots: string[];
};

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

/** 불가능 시간을 한 줄로 다 늘어놓지 않고 날짜별로 묶어서 보여주기 위함 */
function groupBusySlotsByDay(busySlots: string[]) {
  const order: string[] = [];
  const labels = new Map<string, string>();
  const times = new Map<string, string[]>();

  for (const key of [...busySlots].sort()) {
    const dt = new Date(key);
    const dayKey = `${dt.getFullYear()}-${dt.getMonth()}-${dt.getDate()}`;
    if (!times.has(dayKey)) {
      order.push(dayKey);
      labels.set(dayKey, `${dt.getMonth() + 1}/${dt.getDate()}(${DAY_NAMES[dt.getDay()]})`);
      times.set(dayKey, []);
    }
    const hh = String(dt.getHours()).padStart(2, "0");
    const mm = String(dt.getMinutes()).padStart(2, "0");
    times.get(dayKey)!.push(`${hh}:${mm}`);
  }

  return order.map((dayKey) => ({ dayLabel: labels.get(dayKey)!, times: times.get(dayKey)! }));
}

export default function InterviewersPage() {
  const [interviewers, setInterviewers] = useState<InterviewerRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  const [allSlots, setAllSlots] = useState<GridSlot[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [calendarDraft, setCalendarDraft] = useState<Set<string>>(new Set());
  const [savingCalendar, setSavingCalendar] = useState(false);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newRole, setNewRole] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/interviewers");
    const data = await res.json();
    setInterviewers(data);
    setDrafts(Object.fromEntries(data.map((p: InterviewerRow) => [p.id, p.email ?? ""])));
  }

  useEffect(() => {
    load();
    fetch("/api/slots")
      .then((res) => res.json())
      .then(setAllSlots);
  }, []);

  function openCalendarEditor(p: InterviewerRow) {
    setEditingId((cur) => (cur === p.id ? null : p.id));
    setCalendarDraft(new Set(p.busy_slots));
  }

  function paintCalendar(key: string, select: boolean) {
    setCalendarDraft((cur) => {
      const next = new Set(cur);
      if (select) next.add(key);
      else next.delete(key);
      return next;
    });
  }

  async function saveCalendar(id: string) {
    setSavingCalendar(true);
    await fetch(`/api/interviewers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ busy_slots: Array.from(calendarDraft) }),
    });
    setSavingCalendar(false);
    setEditingId(null);
    setToast("불가능한 시간을 직접 수정했습니다.");
    load();
  }

  async function saveEmail(id: string) {
    setBusyId(id);
    await fetch(`/api/interviewers/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: drafts[id] }),
    });
    setBusyId(null);
    load();
  }

  async function sendInvite(id: string) {
    setBusyId(id);
    const res = await fetch(`/api/interviewers/${id}/invite`, { method: "POST" });
    setBusyId(null);
    if (res.ok) {
      setToast("불가능 시간 문의 이메일을 보냈습니다.");
    } else {
      const body = await res.json();
      setToast(body.error ?? "이메일 발송에 실패했습니다.");
    }
  }

  async function handleAddInterviewer(e: React.FormEvent) {
    e.preventDefault();
    setAddError(null);

    if (!newName.trim() || !newRole.trim()) {
      setAddError("이름과 직무는 필수입니다.");
      return;
    }

    setAdding(true);
    const res = await fetch("/api/interviewers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, role: newRole, email: newEmail }),
    });
    setAdding(false);

    if (!res.ok) {
      const body = await res.json();
      setAddError(body.error ?? "등록에 실패했습니다.");
      return;
    }

    setNewName("");
    setNewRole("");
    setNewEmail("");
    setShowAddForm(false);
    load();
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div className="flex items-start justify-between">
        <div>
          <Link href="/interviews" className="text-sm text-muted-foreground hover:underline">
            ← 대시보드로
          </Link>
          <h1 className="mt-1 text-2xl font-bold">면접관 관리</h1>
          <p className="text-sm text-muted-foreground">
            이메일을 등록해두면 면접관에게 불가능한 시간을 문의하는 메일을 보낼 수 있습니다.
          </p>
        </div>
        <Button onClick={() => setShowAddForm((v) => !v)}>
          {showAddForm ? "취소" : "+ 면접관 추가"}
        </Button>
      </div>

      {showAddForm && (
        <Card>
          <CardContent className="p-4">
            <form onSubmit={handleAddInterviewer} className="flex flex-col gap-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="newName">이름</Label>
                  <Input
                    id="newName"
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="예: 김지훈"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="newRole">직무</Label>
                  <Input
                    id="newRole"
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value)}
                    placeholder="예: 프론트엔드 리드"
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="newEmail">이메일 (선택)</Label>
                <Input
                  id="newEmail"
                  type="email"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  placeholder="email@example.com"
                />
              </div>
              {addError && <p className="text-sm text-destructive">{addError}</p>}
              <div className="flex justify-end">
                <Button type="submit" disabled={adding}>
                  {adding ? "등록 중..." : "등록"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {toast && <p className="text-sm text-primary">{toast}</p>}

      <div className="flex flex-col gap-3">
        {interviewers?.map((p) => (
          <Card key={p.id}>
            <CardContent className="flex flex-col gap-3 p-4">
              <div className="flex items-baseline justify-between">
                <span className="font-semibold">
                  {p.name} <span className="text-sm font-normal text-muted-foreground">· {p.role}</span>
                </span>
              </div>
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>
                  현재 불가능 시간: {p.busy_slots.length ? `${p.busy_slots.length}개` : "없음"}
                </span>
                {p.busy_slots.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setExpandedId((cur) => (cur === p.id ? null : p.id))}
                    className="text-primary underline"
                  >
                    {expandedId === p.id ? "숨기기" : "보기"}
                  </button>
                )}
              </div>

              {expandedId === p.id && (
                <div className="flex flex-col gap-1 rounded-md bg-muted/50 p-2.5 text-xs">
                  {groupBusySlotsByDay(p.busy_slots).map((group) => (
                    <div key={group.dayLabel}>
                      <span className="font-semibold">{group.dayLabel}</span>{" "}
                      <span className="text-muted-foreground">{group.times.join(", ")}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Input
                  type="email"
                  value={drafts[p.id] ?? ""}
                  onChange={(e) => setDrafts((cur) => ({ ...cur, [p.id]: e.target.value }))}
                  placeholder="email@example.com"
                />
                <Button variant="outline" disabled={busyId === p.id} onClick={() => saveEmail(p.id)}>
                  저장
                </Button>
                <Button disabled={busyId === p.id || !p.email} onClick={() => sendInvite(p.id)}>
                  문의 메일 보내기
                </Button>
                <Button variant="outline" onClick={() => openCalendarEditor(p)}>
                  {editingId === p.id ? "닫기" : "직접 캘린더 수정"}
                </Button>
              </div>

              {editingId === p.id && (
                <div className="flex flex-col gap-2 rounded-md border p-3">
                  <p className="text-xs text-muted-foreground">
                    이메일 응답 없이 리크루터가 직접 불가능한 시간을 표시합니다. 30분 단위로
                    클릭하거나 드래그해서 여러 칸을 한번에 선택할 수 있습니다.
                  </p>
                  <SlotGrid slots={allSlots} selected={calendarDraft} onPaint={paintCalendar} />
                  <div className="flex justify-end">
                    <Button size="sm" disabled={savingCalendar} onClick={() => saveCalendar(p.id)}>
                      {savingCalendar ? "저장 중..." : "캘린더 저장"}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
