import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseCapacity } from "../route";

type Params = { params: Promise<{ id: string }> };

/**
 * 면접실 수정(이름·정원·사용 여부).
 *
 * 이미 쓰인 적 있는 면접실은 삭제하지 않고 active=false("사용 안 함")로 둔다.
 * interviews.room_id가 rooms(id)를 참조하므로(supabase/schema.sql) 애초에 지워지지도
 * 않고, 지난 면접 기록에서 면접실 이름이 사라지는 것도 원하는 동작이 아니다.
 * 사용 안 함으로 두면 새 매칭에서만 빠지고 기록은 그대로 남는다(lib/rooms.ts의 isRoomUsable).
 */
export async function PATCH(request: Request, { params }: Params) {
  const { id } = await params;
  const body = (await request.json()) as {
    name?: string;
    capacity?: unknown;
    active?: boolean;
  };

  const patch: Record<string, unknown> = {};

  if (body.name !== undefined) {
    if (!body.name.trim()) {
      return NextResponse.json({ error: "면접실 이름은 비울 수 없습니다." }, { status: 400 });
    }
    patch.name = body.name.trim();
  }

  if (body.capacity !== undefined) {
    const parsed = parseCapacity(body.capacity);
    if (!parsed.ok) {
      return NextResponse.json(
        { error: "정원은 1 이상의 정수이거나 비워두어야 합니다." },
        { status: 400 },
      );
    }
    patch.capacity = parsed.value;
  }

  if (body.active !== undefined) patch.active = body.active;

  if (!Object.keys(patch).length) {
    return NextResponse.json({ error: "바꿀 내용이 없습니다." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { data, error } = await supabase.from("rooms").update(patch).eq("id", id).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json(data);
}

/**
 * 한 번도 쓰인 적 없는 면접실만 지운다.
 *
 * "사용 안 함"만 있으면, 이름을 잘못 적어 만든 방이 영원히 목록에 남는다 — 지울
 * 방법이 없으니 쓰지도 않는 방이 계속 쌓인다. 그렇다고 조건 없이 지우면 지난 면접
 * 기록이 가리키던 면접실이 사라진다.
 *
 * 그래서 **이 방을 참조하는 면접이 하나도 없을 때만** 지운다. 하나라도 있으면 지우지
 * 않고, 사용 안 함으로 두라고 이유를 붙여 알려준다 — DB가 던지는 외래 키 오류를 그대로
 * 흘려보내면 화면에는 영문 모를 영어 메시지만 뜬다.
 */
export async function DELETE(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data: referencing, error: refError } = await supabase
    .from("interviews")
    .select("id,candidate_name")
    .eq("room_id", id);
  if (refError) return NextResponse.json({ error: refError.message }, { status: 500 });

  if (referencing?.length) {
    return NextResponse.json(
      {
        error:
          `이 면접실을 쓰는 면접이 ${referencing.length}건 있어 삭제할 수 없습니다. ` +
          "지난 기록에서 면접실 이름이 사라지기 때문입니다 — 대신 '사용 안 함'으로 두면 " +
          "앞으로의 자동 배정에서만 빠집니다.",
      },
      { status: 409 },
    );
  }

  const { error } = await supabase.from("rooms").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
