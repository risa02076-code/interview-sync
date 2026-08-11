-- 일정 변경 요청 시 같은 시간을 다시 추천하지 않도록 하는 마이그레이션 (Supabase SQL Editor에서 실행)
--
-- 후보자가 "이 시간엔 참석이 어렵다"며 일정 변경을 요청하면, 그 시간을 항상
-- 추천/제안 후보에서 제외해야 한다. 그렇지 않으면 실시간 재계산 로직이 방금
-- 거절당한 그 시간을 다시 추천해버릴 수 있다.

alter table interviews add column if not exists excluded_slots text[] not null default '{}';
