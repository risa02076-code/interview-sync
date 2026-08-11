-- 면접관 재문의(조회 기간 확장) 마이그레이션 (Supabase SQL Editor에서 실행)
--
-- 면접관 전원이 응답했는데도 동시에 가능한 시간이 하나도 없으면, 후보자에게
-- 충돌 있는 시간을 안내하는 대신 조회 기간을 5영업일씩 넓혀 면접관 전원에게
-- 다시 문의한다. 이 컬럼은 몇 번째 재문의 라운드인지 추적해 무한 반복을 막는다.

alter table interviews add column if not exists availability_round int not null default 1;
