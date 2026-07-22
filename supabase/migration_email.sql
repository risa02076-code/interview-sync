-- 이메일 응답 링크 기능 추가 마이그레이션 (Supabase SQL Editor에서 실행)

alter table interviewers add column if not exists email text;
alter table interviews add column if not exists candidate_email text;

create table if not exists response_requests (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  kind text not null, -- 'candidate' | 'interviewer'
  interview_id uuid references interviews(id) on delete cascade,
  interviewer_id uuid references interviewers(id) on delete cascade,
  status text not null default 'pending', -- 'pending' | 'submitted'
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);

alter table response_requests enable row level security;
