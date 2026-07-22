"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { formatSlotLabel } from "@/lib/slots";

type InterviewerRow = {
  id: string;
  name: string;
  role: string;
  email: string | null;
  busy_slots: string[];
};

export default function InterviewersPage() {
  const [interviewers, setInterviewers] = useState<InterviewerRow[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/interviewers");
    const data = await res.json();
    setInterviewers(data);
    setDrafts(Object.fromEntries(data.map((p: InterviewerRow) => [p.id, p.email ?? ""])));
  }

  useEffect(() => {
    load();
  }, []);

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

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-6">
      <div>
        <Link href="/interviews" className="text-sm text-muted-foreground hover:underline">
          ← 대시보드로
        </Link>
        <h1 className="mt-1 text-2xl font-bold">면접관 관리</h1>
        <p className="text-sm text-muted-foreground">
          이메일을 등록해두면 면접관에게 불가능한 시간을 문의하는 메일을 보낼 수 있습니다.
        </p>
      </div>

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
              <p className="text-xs text-muted-foreground">
                현재 불가능 시간:{" "}
                {p.busy_slots.length
                  ? p.busy_slots
                      .slice()
                      .sort()
                      .map((s) => formatSlotLabel(s))
                      .join(", ")
                  : "없음"}
              </p>
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
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
