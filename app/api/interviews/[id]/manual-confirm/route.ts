import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requiresRoom, type Room } from "@/lib/matching";

type Params = { params: Promise<{ id: string }> };

/**
 * 자동 매칭(전원 공통 시간 탐색·충돌 최소 추천)으로 해결되지 않을 때, 리크루터가
 * 히트맵을 보고 직접 고른 시간으로 강제 확정한다. 겹치는 면접관이 있어도 그대로
 * 진행한다 — 이 API를 호출한다는 것 자체가 리크루터가 그 충돌을 감안하고
 * 내리는 결정이기 때문이다.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const { slot } = (await request.json()) as { slot: string };
  if (!slot) return NextResponse.json({ error: "시간을 선택해주세요." }, { status: 400 });

  const supabase = createAdminClient();
  const { data: interview, error } = await supabase
    .from("interviews")
    .select("*")
    .eq("id", id)
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const { data: panel } = await supabase.from("interviewers").select("*").in("id", interview.panel);
  const needsRoom = requiresRoom(interview.interview_type);
  const { data: rooms } = needsRoom ? await supabase.from("rooms").select("*") : { data: null };

  const conflicts = (panel ?? []).filter((p) => p.busy_slots.includes(slot)).map((p) => p.name);
  const freeRoom = needsRoom ? (rooms as Room[] | null)?.find((r) => !r.busy_slots.includes(slot)) : undefined;

  const { data: updated, error: uErr } = await supabase
    .from("interviews")
    .update({
      matched_slot: slot,
      room_id: freeRoom?.id ?? null,
      status: "confirmed",
      stage: "candidate_done",
      note: conflicts.length
        ? `리크루터가 직접 확정함 (겹침: ${conflicts.join(", ")})`
        : "리크루터가 직접 확정함",
      confirmation_sent_at: null,
    })
    .eq("id", id)
    .select()
    .single();
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 });

  for (const p of panel ?? []) {
    if (!p.busy_slots.includes(slot)) {
      await supabase.from("interviewers").update({ busy_slots: [...p.busy_slots, slot] }).eq("id", p.id);
    }
  }
  if (freeRoom) {
    await supabase
      .from("rooms")
      .update({ busy_slots: [...freeRoom.busy_slots, slot] })
      .eq("id", freeRoom.id);
  }

  return NextResponse.json(updated);
}
