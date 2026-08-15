-- 사람이 읽기 좋은 면접 현황 뷰 (Supabase SQL Editor에서 실행)
--
-- interviews 테이블 원본은 면접관을 UUID 배열로, 시간을 UTC로 저장해서
-- Table Editor에서 그대로 보면 알아보기 어렵다. 이 뷰는 그걸 그대로 두고
-- (원본은 앱 코드가 계속 그 형태로 씀), 사람이 보기 위한 별도의 읽기 전용
-- 창을 하나 더 만드는 것이다 — Table Editor 왼쪽 목록에 "interviews_readable"로
-- interviews와 나란히 뜬다.

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
  r.name as 회의실,
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
