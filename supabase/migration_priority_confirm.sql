-- 면접관 전원 최종 확인 마이그레이션 (Supabase SQL Editor에서 실행)
--
-- 후보자가 1~3순위를 제출하면 리크루터가 수동으로 확정하는 대신, 면접관 전원에게
-- 그 1~3개 시간 각각 참석 가능한지 확인 요청을 보내고, 전원이 가능하다고 한 가장
-- 높은 순위로 자동 확정한다. kind='priority_confirm' 요청에서 어떤 시간을
-- 물어봤는지 기록해두는 컬럼이 필요하다.

alter table response_requests add column if not exists confirm_slots text[];
