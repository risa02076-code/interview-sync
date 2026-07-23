-- 면접 유형 추가 (Supabase SQL Editor에서 실행)
-- '1차 대면' | '2차 대면' | '온라인' | '전화' — 대면이 아니면 회의실 배정 없이 매칭한다.
alter table interviews add column if not exists interview_type text not null default '1차 대면';
