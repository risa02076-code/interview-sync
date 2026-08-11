-- 자동 리마인더 마이그레이션 (Supabase SQL Editor에서 실행)
--
-- 1) 미응답 독촉: 같은 응답 요청을 매일 재발송하지 않도록 마지막 발송 시각과 누적 횟수를 기록한다.
--    reminder_count 로 상한을 두어, 끝내 응답하지 않는 건에 메일이 무한히 나가는 것을 막는다.
-- 2) 면접 전날 알림: 케이스당 한 번만 나가도록 발송 시각을 기록한다.

alter table response_requests add column if not exists reminded_at timestamptz;
alter table response_requests add column if not exists reminder_count int not null default 0;

alter table interviews add column if not exists day_before_reminded_at timestamptz;
