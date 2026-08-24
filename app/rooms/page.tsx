"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { requiredCapacity } from "@/lib/rooms";

type RoomRow = {
  id: string;
  name: string;
  capacity: number | null;
  active: boolean;
  busy_slots: string[];
  /** 지금 이 방을 쓰는 확정 면접 수 — "사용 안 함"이 무엇에 영향을 주는지 알려준다 */
  confirmedCount: number;
};

export default function RoomsPage() {
  const [rooms, setRooms] = useState<RoomRow[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftCapacity, setDraftCapacity] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCapacity, setNewCapacity] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  async function load() {
    const res = await fetch("/api/rooms");
    setRooms(await res.json());
  }

  useEffect(() => {
    load();
  }, []);

  function notify(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3000);
  }

  async function handleAdd() {
    setAdding(true);
    setAddError(null);
    const res = await fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName, capacity: newCapacity }),
    });
    setAdding(false);
    if (!res.ok) {
      setAddError((await res.json()).error ?? "추가하지 못했습니다.");
      return;
    }
    setNewName("");
    setNewCapacity("");
    setShowAddForm(false);
    notify("회의실을 추가했습니다.");
    load();
  }

  function openEditor(room: RoomRow) {
    setEditingId((cur) => (cur === room.id ? null : room.id));
    setDraftName(room.name);
    setDraftCapacity(room.capacity == null ? "" : String(room.capacity));
    setEditError(null);
  }

  async function patch(id: string, body: Record<string, unknown>, message: string) {
    setBusyId(id);
    setEditError(null);
    const res = await fetch(`/api/rooms/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusyId(null);
    if (!res.ok) {
      setEditError((await res.json()).error ?? "저장하지 못했습니다.");
      return false;
    }
    notify(message);
    load();
    return true;
  }

  async function handleSave(id: string) {
    const ok = await patch(id, { name: draftName, capacity: draftCapacity }, "저장했습니다.");
    if (ok) setEditingId(null);
  }

  async function handleToggleActive(room: RoomRow) {
    if (room.active && room.confirmedCount > 0) {
      const proceed = confirm(
        `${room.name}에는 확정된 면접이 ${room.confirmedCount}건 있습니다.\n\n` +
          "사용 안 함으로 바꿔도 이미 잡힌 일정과 기록은 그대로 남고, 앞으로의 자동 배정에서만 빠집니다. 계속할까요?",
      );
      if (!proceed) return;
    }
    await patch(
      room.id,
      { active: !room.active },
      room.active ? "사용 안 함으로 바꿨습니다." : "다시 사용합니다.",
    );
  }

  async function handleDelete(room: RoomRow) {
    if (
      !confirm(
        `${room.name}을(를) 목록에서 지울까요?\n\n` +
          "이 방을 쓴 면접이 하나도 없을 때만 지워집니다. 지난 기록이 있으면 대신 '사용 안 함'으로 두라고 안내합니다.",
      )
    ) {
      return;
    }
    setBusyId(room.id);
    setEditError(null);
    const res = await fetch(`/api/rooms/${room.id}`, { method: "DELETE" });
    setBusyId(null);
    if (!res.ok) {
      // 지울 수 없는 이유(참조하는 면접이 있음)를 그대로 보여준다.
      setEditError((await res.json()).error ?? "삭제하지 못했습니다.");
      setEditingId(room.id);
      return;
    }
    notify("회의실을 지웠습니다.");
    load();
  }

  const missingCapacity = (rooms ?? []).filter((r) => r.active && r.capacity == null).length;

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <Link href="/interviews" className="text-sm text-muted-foreground hover:underline">
        ← 대시보드로
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">회의실 관리</h1>
          <p className="text-sm text-muted-foreground">
            대면 면접은 여기 등록된 회의실 중에서 자동으로 배정됩니다. 정원을 넣으면 면접관
            수에 맞는 방만 고릅니다.
          </p>
        </div>
        <Button onClick={() => setShowAddForm((v) => !v)} variant={showAddForm ? "outline" : "default"}>
          {showAddForm ? "취소" : "+ 회의실 추가"}
        </Button>
      </div>

      {toast && (
        <p className="rounded-md bg-primary/10 px-3 py-2 text-sm text-primary">{toast}</p>
      )}

      {showAddForm && (
        <Card>
          <CardContent className="space-y-3 pt-6">
            <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
              <div className="space-y-1.5">
                <Label htmlFor="new-room-name">회의실 이름</Label>
                <Input
                  id="new-room-name"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="면접실 D"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-room-capacity">정원 (선택)</Label>
                <Input
                  id="new-room-capacity"
                  type="number"
                  min={1}
                  value={newCapacity}
                  onChange={(e) => setNewCapacity(e.target.value)}
                  placeholder="비워두면 제한 없음"
                />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">
              정원은 <b>면접관 수 + 후보자 1명</b>과 비교합니다 — 면접관 4명 면접에는{" "}
              {requiredCapacity(4)}인실 이상이 필요합니다. 비워두면 지금처럼 인원을 따지지
              않고 배정합니다.
            </p>
            {addError && <p className="text-sm text-destructive">{addError}</p>}
            <Button onClick={handleAdd} disabled={adding || !newName.trim()}>
              {adding ? "추가하는 중..." : "추가"}
            </Button>
          </CardContent>
        </Card>
      )}

      {missingCapacity > 0 && (
        <p className="rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-500">
          정원이 입력되지 않은 회의실이 {missingCapacity}개 있습니다. 그 방들은 인원을 따지지
          않고 배정되므로, 면접관이 많은 면접에 작은 방이 잡힐 수 있습니다.
        </p>
      )}

      {rooms === null ? (
        <p className="text-sm text-muted-foreground">불러오는 중...</p>
      ) : rooms.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          등록된 회의실이 없습니다. 회의실이 없으면 대면 면접은 자동으로 확정되지 않습니다.
        </p>
      ) : (
        <div className="space-y-3">
          {rooms.map((room) => (
            <Card key={room.id} className={room.active ? undefined : "opacity-60"}>
              <CardContent className="space-y-3 pt-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-semibold">
                      {room.name}
                      {!room.active && (
                        <span className="ml-2 text-xs font-normal text-muted-foreground">
                          사용 안 함
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {room.capacity == null ? (
                        <span className="text-amber-700 dark:text-amber-500">정원 미입력</span>
                      ) : (
                        `정원 ${room.capacity}명`
                      )}
                      {" · "}
                      확정된 면접 {room.confirmedCount}건
                      {" · "}
                      사용 중인 시간 {room.busy_slots.length}칸
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => openEditor(room)}>
                      {editingId === room.id ? "닫기" : "수정"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busyId === room.id}
                      onClick={() => handleToggleActive(room)}
                    >
                      {room.active ? "사용 안 함" : "다시 사용"}
                    </Button>
                    {/* 한 번도 쓰인 적 없는 방만 지울 수 있다. 쓰인 적 있으면 버튼을
                        아예 감춰서, 눌렀다 거절당하는 경험을 만들지 않는다. */}
                    {room.confirmedCount === 0 && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === room.id}
                        onClick={() => handleDelete(room)}
                      >
                        삭제
                      </Button>
                    )}
                  </div>
                </div>

                {editingId === room.id && (
                  <div className="space-y-3 rounded-md bg-muted/50 p-3">
                    <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
                      <div className="space-y-1.5">
                        <Label htmlFor={`name-${room.id}`}>이름</Label>
                        <Input
                          id={`name-${room.id}`}
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor={`cap-${room.id}`}>정원</Label>
                        <Input
                          id={`cap-${room.id}`}
                          type="number"
                          min={1}
                          value={draftCapacity}
                          onChange={(e) => setDraftCapacity(e.target.value)}
                          placeholder="비워두면 제한 없음"
                        />
                      </div>
                    </div>
                    {editError && <p className="text-sm text-destructive">{editError}</p>}
                    <Button
                      size="sm"
                      disabled={busyId === room.id || !draftName.trim()}
                      onClick={() => handleSave(room.id)}
                    >
                      {busyId === room.id ? "저장 중..." : "저장"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        <b>한 번도 쓰인 적 없는 회의실</b>만 지울 수 있습니다. 이미 면접에 쓰인 방은 대신{" "}
        <b>사용 안 함</b>으로 둡니다 — 지난 면접 기록에 남은 회의실 이름이 사라지지 않게 하기
        위해서입니다. 사용 안 함으로 두면 앞으로의 자동 배정에서만 빠집니다.
      </p>
    </main>
  );
}
