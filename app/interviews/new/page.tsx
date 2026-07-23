"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { INTERVIEW_TYPES } from "@/lib/matching";

type Interviewer = { id: string; name: string; role: string };

export default function NewInterviewPage() {
  const router = useRouter();
  const [interviewers, setInterviewers] = useState<Interviewer[]>([]);
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [position, setPosition] = useState("");
  const [interviewType, setInterviewType] = useState<string>(INTERVIEW_TYPES[0]);
  const [panel, setPanel] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/interviewers")
      .then((res) => res.json())
      .then(setInterviewers);
  }, []);

  function togglePanel(id: string) {
    setPanel((cur) => (cur.includes(id) ? cur.filter((p) => p !== id) : [...cur, id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!candidateName.trim() || !position.trim() || !candidateEmail.trim() || panel.length === 0) {
      setError("후보자 이름·이메일, 지원 직무, 면접 패널(1명 이상)은 필수입니다.");
      return;
    }

    setSubmitting(true);
    const res = await fetch("/api/interviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidateName, candidateEmail, position, panel, interviewType }),
    });
    const body = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(body.error ?? "등록에 실패했습니다.");
      return;
    }

    if (!body.inviteResult?.ok) {
      // 등록은 됐지만 면접관 문의 자동 발송이 실패한 경우 (예: 면접관 이메일 미등록)
      setNotice(
        `등록은 완료됐지만 면접관 문의 발송에 실패했습니다: ${body.inviteResult?.error ?? ""} 상세 화면에서 다시 시도해주세요.`,
      );
      return;
    }

    router.push("/interviews");
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 p-6">
      <h1 className="text-2xl font-bold">새 후보자 등록</h1>
      <p className="text-sm text-muted-foreground">
        등록하면 곧바로 면접 패널 전원에게 가능 시간 문의 메일이 발송됩니다. 전원 응답하면
        자동으로 후보자에게 발송되고, 후보자가 응답하면 자동으로 매칭됩니다.
      </p>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="candidateName">후보자 이름</Label>
            <Input
              id="candidateName"
              value={candidateName}
              onChange={(e) => setCandidateName(e.target.value)}
              placeholder="예: 서지민"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="position">지원 직무</Label>
            <Input
              id="position"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="예: 프론트엔드 개발자"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="candidateEmail">후보자 이메일</Label>
            <Input
              id="candidateEmail"
              type="email"
              value={candidateEmail}
              onChange={(e) => setCandidateEmail(e.target.value)}
              placeholder="예: candidate@example.com"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="interviewType">면접 유형</Label>
            <select
              id="interviewType"
              value={interviewType}
              onChange={(e) => setInterviewType(e.target.value)}
              className="rounded-md border bg-background px-3 py-2 text-sm"
            >
              {INTERVIEW_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label>면접 패널 선택 (2명 이상 권장)</Label>
          <div className="flex flex-wrap gap-2">
            {interviewers.map((p) => (
              <button
                type="button"
                key={p.id}
                onClick={() => togglePanel(p.id)}
                className={`rounded-full border px-3 py-1 text-sm ${
                  panel.includes(p.id)
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground"
                }`}
              >
                {p.name} · {p.role}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {notice && (
          <div className="flex flex-col gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3">
            <p className="text-sm text-destructive">{notice}</p>
            <Button type="button" size="sm" onClick={() => router.push("/interviews")}>
              대시보드로 이동
            </Button>
          </div>
        )}

        {!notice && (
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => router.push("/interviews")}>
              취소
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "발송 중..." : "면접 안내 메일 발송"}
            </Button>
          </div>
        )}
      </form>
    </div>
  );
}
