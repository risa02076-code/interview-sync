import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { findMatch, requiresRoom, type Interviewer, type Room } from "@/lib/matching";
import { computeInterviewerProgress } from "@/lib/interviewerProgress";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  const { id } = await params;
  const supabase = createAdminClient();

  const { data, error } = await supabase.from("interviews").select("*").eq("id", id).single();
  if (error) return NextResponse.json({ error: error.message }, { status: 404 });

  const { data: interviewers } = await supabase.from("interviewers").select("*");
  const { data: rooms } = await supabase.from("rooms").select("*");
  // 이 면접 케이스에 딸린 모든 응답 요청(면접관 불가시간 문의·후보자 순위 제출·
  // 최종 확인·일정 변경 요청) 기본 정보. 이 컬럼들은 항상 존재하므로, 응답 진행률
  // 표시가 마이그레이션 여부와 상관없이 항상 정상 동작하도록 별도 쿼리로 뗀다.
  const { data: baseRequests } = await supabase
    .from("response_requests")
    .select("id,kind,interviewer_id,status,created_at,submitted_at")
    .eq("interview_id", id)
    .order("created_at", { ascending: true });

  // 히스토리 상세(실제로 뭐라고 답했는지)는 마이그레이션이 아직 안 됐으면 컬럼이
  // 없어 쿼리 전체가 실패할 수 있다 — 그 경우에도 위 기본 진행률 표시는 깨지지
  // 않도록, 실패하면 그냥 빈 값으로 대체한다(점진적으로 기능이 켜지는 형태).
  const { data: detailRequests } = await supabase
    .from("response_requests")
    .select("id,confirm_slots,answered_slots,answered_busy_slots,answered_preferred_slots,email_sent_at")
    .eq("interview_id", id);
  const detailById = new Map((detailRequests ?? []).map((d) => [d.id, d]));

  const allRequests = (baseRequests ?? []).map((r) => ({ ...r, ...(detailById.get(r.id) ?? {}) }));
  const requests = allRequests.filter((r) => r.kind === "interviewer");
  // 같은 사람이 여러 번(재확인) 답했을 수 있으니, 매트릭스에 보여줄 "최신 답변"은
  // 최신순으로 찾는다.
  const priorityConfirms = [...allRequests]
    .filter((r) => r.kind === "priority_confirm")
    .sort((a, b) => b.created_at.localeCompare(a.created_at));

  const progress = computeInterviewerProgress(data.panel as string[], requests);

  const history = allRequests.map((r) => ({
    id: r.id,
    kind: r.kind as "interviewer" | "candidate" | "priority_confirm" | "reschedule_request",
    interviewerName: interviewers?.find((p) => p.id === r.interviewer_id)?.name ?? null,
    status: r.status as "pending" | "submitted",
    createdAt: r.created_at,
    submittedAt: r.submitted_at,
    confirmSlots: r.confirm_slots ?? null,
    answeredSlots: r.answered_slots ?? null,
    answeredBusySlots: r.answered_busy_slots ?? null,
    answeredPreferredSlots: r.answered_preferred_slots ?? null,
    // 이 요청 행이 존재한다는 건 실제로 발송을 시도했다는 뜻이라(발송 전에는 행을
    // 안 만듦), null이면 그 시도가 실패했다는 걸 안전하게 알 수 있다 — 히스토리에서도
    // "OO시 발송"이라고 확정적으로 말하면 안 되고 실패 여부를 구분해서 보여줘야 한다.
    emailSentAt: (r as { email_sent_at?: string | null }).email_sent_at ?? null,
  }));

  return NextResponse.json({
    ...data,
    panelDetail: (data.panel as string[])
      .map((pid) => interviewers?.find((p) => p.id === pid))
      .filter(Boolean)
      .map((p) => {
        const forThis = requests.filter((r) => r.interviewer_id === p!.id);
        const latest = forThis.length
          ? forThis.reduce((a, b) => (a.created_at > b.created_at ? a : b))
          : null;
        return {
          ...p!,
          responded: progress.respondedIds.has(p!.id),
          respondedAt:
            requests
              .filter((r) => r.interviewer_id === p!.id && r.status === "submitted")
              .map((r) => r.submitted_at)
              .sort()
              .at(-1) ?? null,
          // 최신 요청(재발송했다면 그 새 토큰) 기준으로 "메일이 실제로 나갔는지"를 본다.
          // 응답 여부(responded)와 별개 — 응답 대기 중인지 발송 자체가 실패했는지를 구분하기 위함.
          emailSentAt: (latest as { email_sent_at?: string | null } | null)?.email_sent_at ?? null,
          priorityConfirm: priorityConfirms.find((r) => r.interviewer_id === p!.id) ?? null,
        };
      }),
    roomName: rooms?.find((r) => r.id === data.room_id)?.name ?? null,
    // 수동 확정 히트맵에서 임의의 시간에 회의실이 비어있는지 판단하는 데 쓴다.
    rooms: rooms ?? [],
    interviewerProgress: { submitted: progress.submitted, total: progress.total },
    history,
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
  const result = findMatch([], panel, roomList, true, requiresRoom(interview.interview_type));
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
      // 시간이 바뀌었으니 예전 시간 기준으로 나갔던 확정 메일은 더 이상 유효하지 않다
      confirmation_sent_at: null,
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
