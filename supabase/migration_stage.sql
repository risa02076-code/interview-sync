-- 면접관 → 후보자 순서 제어를 위한 마이그레이션 (Supabase SQL Editor에서 실행)

alter table interviews add column if not exists stage text not null default 'created';
-- stage: 'created' | 'interviewer_pending' | 'interviewer_done' | 'candidate_pending' | 'candidate_done'
