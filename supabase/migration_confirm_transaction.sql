-- 면접 확정을 하나의 트랜잭션으로 묶는 함수 (Supabase SQL Editor에서 실행)
--
-- ⚠️ 이 파일을 **먼저 실행한 뒤에** 앱을 배포할 것. 앱 코드(lib/applyMatch.ts,
--    app/api/interviews/[id]/manual-confirm/route.ts)가 이 함수를 호출하도록
--    바뀌었기 때문에, 함수가 없는 DB에 새 코드를 올리면 확정이 전부 실패한다.
--
-- 왜 필요한가
-- -----------
-- 확정 한 건은 저장이 세 군데로 나뉜다 — 면접 행, 면접관별 busy_slots, 회의실
-- busy_slots. supabase-js는 여러 요청을 한 트랜잭션으로 묶지 못하므로(요청 하나가
-- 곧 트랜잭션 하나다), 지금까지는 이 셋이 각각 따로 커밋됐다. 그래서 두 가지가
-- 생길 수 있었다.
--
--   1. 반쪽 확정 — 면접 행에는 "확정"이라고 적혔는데 캘린더는 비어 있는 상태.
--      중간에 하나가 실패하면 그대로 남는다.
--   2. 동시 확정 — 두 요청이 같은 순간에 각자 "비어 있네"를 확인하고 둘 다 저장.
--      영화관 좌석 이중 예약과 같다.
--
-- 둘 다 "막지 않고, 생기면 정합성 검사(lib/checkConsistency.ts)가 잡는다"로 두고
-- 있었다. 이 함수는 그중 예방할 수 있는 부분을 실제로 예방한다.
--
-- 어떻게 막는가
-- -------------
-- PostgREST는 요청 하나를 트랜잭션 하나로 감싸므로, 함수 호출 한 번이 곧 트랜잭션
-- 하나다. 함수 안에서 몇 번을 쓰든 전부 커밋되거나 전부 롤백된다. 함수 안에서
-- BEGIN/COMMIT을 직접 쓰는 것이 아니라(함수 안 COMMIT은 2D000 에러다) 호출 자체가
-- 트랜잭션인 것이다.
--
-- 예외를 잡아서 삼키면 안 된다 — EXCEPTION 블록은 세이브포인트를 깔고 그 지점까지만
-- 되돌리므로, 잡고 다시 던지지 않으면 함수 전체가 롤백되지 않는다. 그래서 이 함수에는
-- EXCEPTION 블록을 두지 않고 예외가 그대로 올라가게 둔다.
--
-- 잠금은 두 겹이다.
--   - pg_advisory_xact_lock: 고정 키 하나로 "확정 작업"끼리 절대 겹치지 않게 한다.
--     잠금이 하나뿐이라 잠금 순서 문제(교착)가 원천적으로 없다. 트랜잭션이 끝나면
--     자동으로 풀리므로 Supabase의 트랜잭션 모드 커넥션 풀링에서도 안전하다
--     (세션 단위 pg_advisory_lock은 이 환경에서 유실될 수 있어 쓰지 않는다).
--   - SELECT ... FOR UPDATE: 실제로 쓸 면접관·회의실 행을 잡아둔다. 쓰는 동안
--     다른 경로가 같은 행을 바꾸지 못한다.
--
-- 무엇을 여기 넣지 않았는가
-- -------------------------
-- 시간 탐색·겹침 판정·소요시간 계산은 TypeScript(lib/matching.ts, lib/slots.ts)에
-- 그대로 남겼다. plpgsql은 tsc도 vitest도 닿지 않는 영역이라, 판단이 필요한 로직을
-- 옮기면 검증이 통째로 사라진다. 이 함수가 하는 일은 "잠그고, 다시 확인하고,
-- 세 곳에 쓴다" 뿐이며, 점유 구간(p_span)은 호출하는 쪽이 occupiedSlots로 계산해
-- 넘긴다.

create or replace function confirm_interview(
  p_interview_id uuid,
  p_slot text,
  p_span text[],
  p_room_id uuid default null,
  p_status text default 'confirmed',
  p_note text default null,
  -- null이면 기존 값을 그대로 둔다(호출하는 경로마다 건드리는 컬럼이 다르다)
  p_stage text default null,
  p_preferred_slots text[] default null,
  -- 확정 시간이 바뀌었으니 "확정 메일 보냄" 표시를 지워야 하는 경우
  p_reset_confirmation boolean default false,
  -- true면 겹쳐도 그대로 확정한다. 리크루터의 수동 확정이 이 경우다 —
  -- 호출한다는 것 자체가 충돌을 감안한 사람의 결정이라 막지 않는다.
  p_force boolean default false,
  -- 원자성 검증 전용. 모든 쓰기를 마친 직후 예외를 던져서, 정말로 전부
  -- 되돌아가는지 scripts/verify-confirm-transaction.ts가 확인할 수 있게 한다.
  -- 기본값 false이며, true여도 예외를 던지는 것 외에는 아무 일도 하지 않는다.
  p_abort_for_test boolean default false
)
returns interviews
language plpgsql
as $$
declare
  v_interview interviews;
  v_panel uuid[];
  v_conflicts text;
  v_room_busy boolean;
begin
  -- 확정 작업끼리는 절대 겹치지 않게 한다. 트랜잭션이 끝나면 자동으로 풀린다.
  perform pg_advisory_xact_lock(hashtext('interview-sync:confirm'));

  select * into v_interview from interviews where id = p_interview_id for update;
  if not found then
    raise exception '면접을 찾을 수 없습니다 (id=%)', p_interview_id
      using errcode = 'PT404';
  end if;
  v_panel := v_interview.panel;

  -- 실제로 쓸 행을 잡아둔다. 자문 잠금이 이미 확정끼리를 직렬화하므로 잠금 순서
  -- 때문에 교착이 날 수 없지만, id 순서로 잡아 습관 자체를 안전하게 유지한다.
  perform id from interviewers where id = any(v_panel) order by id for update;
  if p_room_id is not null then
    perform id from rooms where id = p_room_id for update;
  end if;

  -- 잠근 뒤에 "지금 이 순간" 기준으로 다시 확인한다. 호출한 쪽이 findMatch로
  -- 판단할 때 읽은 데이터는 그 사이에 바뀌었을 수 있다 — 이 재확인이 이중 배정을
  -- 실제로 막는 지점이다.
  if not p_force and coalesce(array_length(p_span, 1), 0) > 0 then
    select string_agg(name, ', ' order by name) into v_conflicts
      from interviewers
     where id = any(v_panel) and busy_slots && p_span;
    if v_conflicts is not null then
      raise exception '이미 다른 일정이 잡혀 있는 면접관: %', v_conflicts
        using errcode = 'PT409';
    end if;

    if p_room_id is not null then
      select true into v_room_busy
        from rooms where id = p_room_id and busy_slots && p_span;
      if coalesce(v_room_busy, false) then
        raise exception '회의실이 이 시간에 이미 사용 중입니다 (room_id=%)', p_room_id
          using errcode = 'PT409';
      end if;
    end if;
  end if;

  update interviews
     set matched_slot = p_slot,
         room_id = p_room_id,
         status = p_status,
         note = p_note,
         stage = coalesce(p_stage, stage),
         preferred_slots = coalesce(p_preferred_slots, preferred_slots),
         confirmation_sent_at = case
           when p_reset_confirmation then null else confirmation_sent_at
         end
   where id = p_interview_id
  returning * into v_interview;

  if coalesce(array_length(p_span, 1), 0) > 0 then
    -- 더하기만 한다. 기존 값에는 면접관 본인이 표시한 개인 일정도 섞여 있어서
    -- 어떤 항목이 면접 때문에 생긴 것인지 구분할 수 없다(lib/backfillBusySlots.ts와
    -- 같은 이유). 정렬해서 넣어 결과가 항상 같은 모양이 되게 한다.
    update interviewers
       set busy_slots = (
             select coalesce(array_agg(distinct s order by s), '{}')
               from unnest(busy_slots || p_span) as s
           )
     where id = any(v_panel);

    if p_room_id is not null then
      update rooms
         set busy_slots = (
               select coalesce(array_agg(distinct s order by s), '{}')
                 from unnest(busy_slots || p_span) as s
             )
       where id = p_room_id;
    end if;
  end if;

  if p_abort_for_test then
    raise exception '원자성 검증용 강제 중단 — 여기까지의 모든 쓰기가 롤백되어야 한다'
      using errcode = 'PT500';
  end if;

  return v_interview;
end;
$$;

-- SQLSTATE는 PostgREST의 PT 접두사 규칙을 쓴다 — PT409를 던지면 HTTP 409로 나가고,
-- supabase-js의 error.code에 'PT409'가 그대로 담긴다. 호출하는 쪽이 문구를 비교하지
-- 않고 코드로 분기할 수 있게 하려는 것이다(b853549에서 "그냥 실패"와 "사람 판단을
-- 기다리는 보류"를 문구 비교 없이 구분한 것과 같은 이유).

-- 이 앱은 브라우저에서 DB에 직접 접근하지 않는다(모든 접근은 서비스 롤 키를 쓰는
-- /api/* 라우트를 거친다). 함수는 기본적으로 PUBLIC에 EXECUTE가 열리므로, 익명·로그인
-- 역할에서 명시적으로 회수해 REST로 직접 호출되는 경로를 닫는다.
revoke execute on function confirm_interview(
  uuid, text, text[], uuid, text, text, text, text[], boolean, boolean, boolean
) from public, anon, authenticated;
