import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findMatch, type Interviewer, type Room } from "@/lib/matching";

export async function GET() {
  const supabase = createAdminClient();

  const { data: interviews, error } = await supabase
    .from("interviews")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: interviewers } = await supabase.from("interviewers").select("id,name,role");
  const { data: rooms } = await supabase.from("rooms").select("id,name");

  const enriched = interviews.map((iv) => ({
    ...iv,
    panelDetail: (iv.panel as string[])
      .map((id) => interviewers?.find((p) => p.id === id))
      .filter(Boolean),
    roomName: rooms?.find((r) => r.id === iv.room_id)?.name ?? null,
  }));

  return NextResponse.json(enriched);
}

export async function POST(request: Request) {
  const body = await request.json();
  const { candidateName, position, panel, preferredSlots } = body as {
    candidateName: string;
    position: string;
    panel: string[];
    preferredSlots: number[];
  };

  if (!candidateName?.trim() || !position?.trim() || !panel?.length) {
    return NextResponse.json(
      { error: "후보자 이름, 직무, 면접 패널은 필수입니다." },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();

  const { data: panelInterviewers, error: pErr } = await supabase
    .from("interviewers")
    .select("*")
    .in("id", panel);
  if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 });

  const { data: rooms, error: rErr } = await supabase.from("rooms").select("*");
  if (rErr) return NextResponse.json({ error: rErr.message }, { status: 500 });

  const result = findMatch(
    preferredSlots ?? [],
    panelInterviewers as Interviewer[],
    rooms as Room[],
    false,
  );

  const { data: created, error: cErr } = await supabase
    .from("interviews")
    .insert({
      candidate_name: candidateName,
      position,
      panel,
      preferred_slots: preferredSlots ?? [],
      matched_slot: result.matchedSlot,
      room_id: result.roomId,
      status: result.status,
      note: result.note,
    })
    .select()
    .single();
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 });

  // 확정된 경우에만 패널·회의실의 가용 슬롯을 갱신한다 (다음 매칭에 반영되도록)
  if (result.status === "confirmed" && result.matchedSlot !== null) {
    for (const p of panelInterviewers as Interviewer[]) {
      await supabase
        .from("interviewers")
        .update({ busy_slots: [...p.busy_slots, result.matchedSlot] })
        .eq("id", p.id);
    }
    const room = (rooms as Room[]).find((r) => r.id === result.roomId);
    if (room) {
      await supabase
        .from("rooms")
        .update({ busy_slots: [...room.busy_slots, result.matchedSlot] })
        .eq("id", room.id);
    }
  }

  return NextResponse.json(created, { status: 201 });
}
