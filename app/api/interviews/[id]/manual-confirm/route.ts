import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { confirmInterviewAtomically } from "@/lib/confirmInterview";
import { requiresRoom } from "@/lib/matching";
import { isRoomUsable, type ManagedRoom } from "@/lib/rooms";
import { interviewDurationMinutes, occupiedSlots } from "@/lib/slots";
import { computeInterviewerProgress } from "@/lib/interviewerProgress";
import { resolveManualConfirmNote } from "@/lib/manualConfirmNote";

type Params = { params: Promise<{ id: string }> };

/**
 * 자동 매칭(전원 공통 시간 탐색·충돌 최소 추천)으로 해결되지 않을 때, 리크루터가
 * 히트맵을 보고 직접 고른 시간으로 강제 확정한다. 겹치는 면접관이 있어도 그대로
 * 진행한다 — 이 API를 호출한다는 것 자체가 리크루터가 그 충돌을 감안하고
 * 내리는 결정이기 때문이다.
 */
export async function POST(request: Request, { params }: Params) {
  const { id } = await params;
  const { slot, confirmDespiteUnresponded } = (await request.json()) as {
    slot: string;
    confirmDespiteUnresponded?: boolean;
  };
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

  // 수동 확정도 면접이 실제로 차지하는 시간 전체를 기준으로 다룬다. 시작 슬롯만
  // 보면 1시간 면접의 뒷 30분에 겹치는 면접관을 "겹침 없음"으로 안내하고, 그 30분을
  // 캘린더에도 남기지 않아 다음 조율에서 또 겹치는 일정이 잡힌다.
  const span = occupiedSlots(slot, interviewDurationMinutes(interview.interview_type));

  // 히트맵의 "가능"에는 실제 답변과 미응답(침묵)이 똑같은 초록색으로 섞여 있다 —
  // 담당자가 그 구분을 화면에서 놓치면 확정된 뒤엔 그 사실이 사라진다. 누가 아직
  // 응답 안 했는지는 사람이 알아채는 데 기대지 않고 여기서 기계적으로 계산한다
  // (lib/manualConfirmNote.ts).
  const { data: interviewerRequests } = await supabase
    .from("response_requests")
    .select("interviewer_id,status,created_at")
    .eq("interview_id", id)
    .eq("kind", "interviewer");
  const progress = computeInterviewerProgress((interview.panel as string[]) ?? [], interviewerRequests ?? []);

  // note에 남기는 것만으로는 담당자가 화면을 안 보고 지나칠 수 있다. 그래서 미응답자가
  // 있으면 여기서 먼저 멈춰 세운다 — sendConfirmationEmail의 정합성 보류(held)와 같은
  // 패턴이다. 문제없다고 판단하면 confirmDespiteUnresponded로 다시 불러 진행한다.
  const noteResult = resolveManualConfirmNote(panel ?? [], span, progress.respondedIds, confirmDespiteUnresponded === true);
  if (!noteResult.ok) {
    return NextResponse.json({ error: noteResult.error, held: true }, { status: 409 });
  }
  const note = noteResult.note;

  // 담당자가 시간을 직접 고르더라도 면접실은 자동으로 잡는다. 그래서 자동 매칭과
  // 같은 기준을 쓴다 — 사용 안 함으로 표시됐거나 인원이 안 들어가는 방을 조용히
  // 배정하면, 사람이 고른 것도 아니면서 규칙만 어긴 결과가 남는다.
  const freeRoom = needsRoom
    ? (rooms as ManagedRoom[] | null)?.find(
        (r) =>
          isRoomUsable(r, (panel ?? []).length) && span.every((s) => !r.busy_slots.includes(s)),
      )
    : undefined;

  // 면접 행·면접관 캘린더·면접실을 나눠 쓰면 중간에 하나가 실패했을 때 반쪽 상태가
  // 남는다. DB 함수 하나로 묶어 전부 되거나 전부 안 되게 한다(lib/confirmInterview.ts).
  //
  // force로 부른다 — 이 경로는 겹쳐도 그대로 진행하는 것이 원래 설계다. 트랜잭션이
  // 생겨도 그 판단은 바뀌지 않는다. 겹침을 막는 것이 아니라, 저장이 반쪽으로
  // 끝나지 않게 하는 것이 여기서 얻는 것이다.
  try {
    const updated = await confirmInterviewAtomically(supabase, {
      interviewId: id,
      slot,
      span,
      roomId: freeRoom?.id ?? null,
      status: "confirmed",
      note,
      stage: "candidate_done",
      resetConfirmation: true,
      force: true,
    });
    return NextResponse.json(updated);
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
