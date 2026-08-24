-- 읽기 전용 뷰의 컬럼 이름을 "회의실" → "면접실"로 통일 (Supabase SQL Editor에서 실행)
--
-- 화면과 코드의 표기는 전부 "면접실"로 맞췄는데, Supabase Table Editor에서 보는
-- 읽기용 뷰만 아직 "회의실"이라고 나온다. 같은 것을 두 이름으로 부르면 사람이
-- 헷갈리므로 라벨을 맞춘다.
--
-- **선택 사항이다.** 이 뷰들은 사람이 Table Editor에서 훑어볼 때만 쓰고 앱 코드는
-- 원본 테이블을 직접 읽는다. 실행하지 않아도 앱 동작에는 아무 영향이 없다.
--
-- 테이블·컬럼 이름(rooms, room_id)은 그대로 둔다. 바꾸려면 스키마 마이그레이션과
-- 코드 전반의 식별자 변경이 따라오는데, 사용자에게 보이지 않는 이름이라 그 위험을
-- 감수할 이유가 없다. 표기 통일은 "사람이 읽는 곳"까지만 한다.

create or replace view interviews_readable as
select
  i.id,
  i.candidate_name as 후보자,
  i.position as 직무,
  i.interview_type as 면접유형,
  i.status,
  i.stage,
  (
    select string_agg(iv.name, ', ' order by iv.name)
    from interviewers iv
    where iv.id = any(i.panel)
  ) as 면접관,
  r.name as 면접실,
  to_char(i.matched_slot::timestamptz at time zone 'Asia/Seoul', 'MM/DD(Dy) HH24:MI') as 확정_시간,
  to_char(i.confirmation_sent_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') as 확정메일_발송시각,
  (
    select string_agg(to_char(s::timestamptz at time zone 'Asia/Seoul', 'MM/DD(Dy) HH24:MI'), ',  ' order by s)
    from unnest(i.preferred_slots) as s
  ) as 후보자_제출_순위,
  coalesce(array_length(i.excluded_slots, 1), 0) as 제외된_시간_개수,
  to_char(i.created_at at time zone 'Asia/Seoul', 'MM/DD HH24:MI') as 등록시각
from interviews i
left join rooms r on r.id = i.room_id
order by i.created_at desc;

create or replace view rooms_readable as
select
  r.id,
  r.name as 면접실,
  r.capacity as 정원,
  case when r.active then '사용' else '사용 안 함' end as 상태,
  coalesce(array_length(r.busy_slots, 1), 0) as 사용중_시간_개수,
  (select count(*) from interviews i
    where i.room_id = r.id and i.status in ('confirmed', 'rescheduled')) as 확정_면접_수
from rooms r
order by r.active desc, r.name;
