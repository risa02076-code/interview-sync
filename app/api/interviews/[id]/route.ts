import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findMatch, type Interviewer, type Room } from "@/lib/matching";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data, error } = await supabase.from("interviews").select("*").eq("id", id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const { data: interviewers } = await supabase.from("interviewers").select("*");
  const { data: rooms } = await supabase.from("rooms").select("*");
  const { data: requests } = await supabase
    .from("response_requests")
    .select("interviewer_id,status")
    .eq("interview_id", id)
    .eq("kind", "interviewer");

  return NextResponse.json({
    ...data,
    panelDetail: (data.panel as string[])
      .map((pid) => interviewers?.find((p) => p.id === pid))
      .filter(Boolean),
    roomName: rooms?.find((r) => r.id === data.room_id)?.name ?? null,
    interviewerProgress: {
      submitted: requests?.filter((r) => r.status === "submitted").length ?? 0,
      total: requests?.length ?? 0,
    },
  });
}

export async function PATCH(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: interview, error } = await supabase
    .from("interviews")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  if (!["confirmed", "rescheduled"].includes(interview.status)) {
    return NextResponse.json(
      { error: "확정되었거나 재조율된 일정만 시뮬레이션할 수 있습니다." },
      { status: 400 },
    );
  }

  const { data: panelInterviewers } = await supabase
    .from("interviewers")
    .select("*")
    .in("id", interview.panel);
  const { data: rooms } = await supabase.from("rooms").select("*");

  const panel = panelInterviewers as Interviewer[];
  const roomList = rooms as Room[];

  // 패널의 첫 번째 면접관 일정에 충돌을 주입해 "면접관 일정 변경"을 시뮬레이션한다
  const trigger = panel[0];
  const triggerBusy = [...trigger.busy_slots, interview.matched_slot];
  await supabase.from("interviewers").update({ busy_slots: triggerBusy }).eq("id", trigger.id);
  trigger.busy_slots = triggerBusy;

  if (interview.room_id) {
    const room = roomList.find((r) => r.id === interview.room_id);
    if (room) {
      const freedBusy = room.busy_slots.filter((s: string) => s !== interview.matched_slot);
      await supabase.from("rooms").update({ busy_slots: freedBusy }).eq("id", room.id);
      room.busy_slots = freedBusy;
    }
  }

  // 트러블슈팅: 재조율 시에는 후보자의 원래 희망시간에 갇히지 않고 전체 슬롯을 재탐색한다
  const result = findMatch([], panel, roomList, true);
  const note =
    result.status === "rescheduled"
      ? `${trigger.name}님 일정 변경 감지 → 새 일정으로 자동 재조율됨`
      : `${trigger.name}님 일정 변경 감지 → 대체 일정 없음, 리크루터 확인 필요`;

  const { data: updated, error: uErr } = await supabase
    .from("interviews")
    .update({
      matched_slot: result.matchedSlot,
      room_id: result.roomId,
      status: result.status,
      note,
    })
    .eq("id", id)
    .select()
    .single();
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  if (result.status === "rescheduled" && result.matchedSlot !== null) {
    for (const p of panel) {
      await supabase
        .from("interviewers")
        .update({ busy_slots: [...p.busy_slots, result.matchedSlot] })
        .eq("id", p.id);
    }
    const room = roomList.find((r) => r.id === result.roomId);
    if (room) {
      await supabase
        .from("rooms")
        .update({ busy_slots: [...room.busy_slots, result.matchedSlot] })
        .eq("id", room.id);
    }
  }

  return NextResponse.json(updated);
}

export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = createAdminClient();
  const { error } = await supabase.from("interviews").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
