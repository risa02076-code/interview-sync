-- 확정 알림 메일 발송 여부 추적 (Supabase SQL Editor에서 실행)
alter table interviews add column if not exists confirmation_sent_at timestamptz;
