-- 회의실 관리(추가·정원·사용 여부) 마이그레이션 (Supabase SQL Editor에서 실행)
--
-- ⚠️ 이 파일을 **먼저 실행한 뒤에** push할 것. 앱 코드가 두 컬럼을 조회하도록
--    바뀌었기 때문에, 컬럼이 없는 DB에 새 코드가 올라가면 회의실 조회가 실패한다.
--    (supabase/migration_confirm_transaction.sql과 같은 주의사항)
--
-- 왜 필요한가
-- -----------
-- 지금까지 rooms는 id·name·busy_slots뿐이었고, 회의실을 추가하거나 고치는 화면도
-- API도 없었다. 시드 데이터로 들어간 3개가 전부이고, 하나 늘리려면 Supabase Table
-- Editor에 직접 들어가야 한다 — 그런데 채용담당자에게는 그 권한이 없다.
--
-- 두 컬럼을 더한다.
--
-- capacity — 그 방에 몇 명이 들어갈 수 있는지.
--   지금 매칭은 "처음 발견한 빈 방"을 그대로 쓴다(lib/matching.ts의 rooms.find).
--   면접관 4명 면접에 2인실이 배정돼도 시스템은 알 방법이 없었다. 이 값이 있으면
--   "면접관 수 + 후보자 1명"이 들어가는 방만 고를 수 있다.
--
--   **null을 허용한다.** 이미 있는 회의실들은 실제 정원을 모르는 상태이고, 여기에
--   임의의 숫자를 넣으면 그 추측이 곧 매칭 규칙이 된다. null은 "아직 모름"이고
--   매칭은 종전대로 동작한다(제한 없음). 화면에서 "정원 미입력"으로 눈에 띄게
--   표시해, 값을 넣는 순간부터 규칙이 적용된다는 것을 알 수 있게 한다.
--
-- active — 지금 쓸 수 있는 방인지.
--   삭제 대신 이 값을 쓴다. interviews.room_id가 rooms(id)를 참조하므로(schema.sql),
--   확정된 면접이 쓰고 있는 방은 애초에 지워지지 않는다 — 지우려 하면 DB가 거부하고
--   화면에는 영문 모를 오류만 뜬다. 없애는 대신 "사용 안 함"으로 두면 지난 면접
--   기록은 그대로 남고 새 매칭에서만 빠진다.

alter table rooms add column if not exists capacity int;
alter table rooms add column if not exists active boolean not null default true;

-- 정원은 "모름(null)"이거나 1명 이상이어야 한다. 0이나 음수가 들어가면 그 방은
-- 어떤 면접에도 배정될 수 없으면서 화면에는 정상으로 보인다.
alter table rooms drop constraint if exists rooms_capacity_positive;
alter table rooms add constraint rooms_capacity_positive
  check (capacity is null or capacity > 0);

-- 사람이 Table Editor에서 직접 훑어볼 때 쓰는 읽기 전용 뷰에도 새 컬럼을 반영한다.
create or replace view rooms_readable as
select
  r.id,
  r.name as 회의실,
  r.capacity as 정원,
  case when r.active then '사용' else '사용 안 함' end as 상태,
  coalesce(array_length(r.busy_slots, 1), 0) as 사용중_시간_개수,
  (select count(*) from interviews i
    where i.room_id = r.id and i.status in ('confirmed', 'rescheduled')) as 확정_면접_수
from rooms r
order by r.active desc, r.name;
