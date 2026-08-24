import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * 회의실 목록·추가.
 *
 * 지금까지 회의실은 시드 데이터로 들어간 것이 전부였고 추가할 방법이 없었다 —
 * Supabase Table Editor에 직접 들어가야 했는데 채용담당자에게는 그 권한이 없다.
 *
 * 목록에는 "이 방을 쓰는 확정 면접이 몇 건인지"를 함께 담는다. 그게 없으면
 * "사용 안 함"으로 바꾸는 것이 지금 잡혀 있는 일정에 영향을 주는지 알 수 없다.
 */

/** 정원 입력값 검증. null(모름)은 허용하고, 그 외에는 1 이상의 정수만 받는다. */
export function parseCapacity(value: unknown): { ok: true; value: number | null } | { ok: false } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 1) return { ok: false };
  return { ok: true, value: n };
}

export async function GET() {
  const supabase = createAdminClient();
  const { data: rooms, error } = await supabase
    .from("rooms")
    .select("id,name,capacity,active,busy_slots")
    .order("name");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const { data: interviews } = await supabase
    .from("interviews")
    .select("room_id,status")
    .in("status", ["confirmed", "rescheduled"]);

  const confirmedByRoom = new Map<string, number>();
  for (const iv of interviews ?? []) {
    if (!iv.room_id) continue;
    confirmedByRoom.set(iv.room_id, (confirmedByRoom.get(iv.room_id) ?? 0) + 1);
  }

  return NextResponse.json(
    (rooms ?? []).map((r) => ({ ...r, confirmedCount: confirmedByRoom.get(r.id) ?? 0 })),
  );
}

export async function POST(request: Request) {
  const { name, capacity } = (await request.json()) as { name?: string; capacity?: unknown };

  if (!name?.trim()) {
    return NextResponse.json({ error: "회의실 이름은 필수입니다." }, { status: 400 });
  }
  const parsed = parseCapacity(capacity);
  if (!parsed.ok) {
    return NextResponse.json(
      { error: "정원은 1 이상의 정수이거나 비워두어야 합니다." },
      { status: 400 },
    );
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("rooms")
    .insert({ name: name.trim(), capacity: parsed.value })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...data, confirmedCount: 0 }, { status: 201 });
}
