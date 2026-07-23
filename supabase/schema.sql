-- 인터뷰싱크 스키마 (Supabase SQL Editor에 붙여넣어 실행)
-- 처음부터 새로 만들 때 쓰는 최종본. 지금까지의 증분 변경 이력은
-- migration_email.sql / migration_stage.sql / migration_dynamic_slots.sql /
-- migration_confirmation.sql / migration_interview_type.sql 참고.
--
-- 슬롯은 고정 목록이 아니라, 매 요청 시점 기준 "다음 영업일 N일"을 동적으로 계산해
-- ISO 날짜시각 문자열(text)로 표현한다 (lib/slots.ts의 generateUpcomingSlots).

create extension if not exists pgcrypto;

create table if not exists interviewers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  email text,
  busy_slots text[] not null default '{}'
);

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  busy_slots text[] not null default '{}'
);

create table if not exists interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_name text not null,
  candidate_email text,
  position text not null,
  -- '1차 대면' | '2차 대면' | '온라인' | '전화' — 대면이 아니면 회의실 없이 매칭
  interview_type text not null default '1차 대면',
  panel uuid[] not null default '{}',
  preferred_slots text[] not null default '{}',
  matched_slot text,
  room_id uuid references rooms(id),
  status text not null default 'pending',
  -- stage: 'created' | 'interviewer_pending' | 'interviewer_done' | 'candidate_pending' | 'candidate_done'
  stage text not null default 'created',
  confirmation_sent_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

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

-- RLS 활성화, 정책은 만들지 않음 (API 라우트가 서비스 롤 키로만 접근 — 브라우저 직접 접근 차단)
alter table interviewers enable row level security;
alter table rooms enable row level security;
alter table interviews enable row level security;
alter table response_requests enable row level security;

-- 시드 데이터: 면접관 8명 (이메일·가용시간은 실사용하며 채워짐)
insert into interviewers (name, role) values
  ('이서연', '백엔드팀장'),
  ('박준혁', '백엔드 시니어'),
  ('정민지', 'PM 리드'),
  ('오세훈', '디자인 리드'),
  ('한지우', '분석팀장'),
  ('윤서아', '시니어 분석가'),
  ('배지훈', '시니어 디자이너'),
  ('신동혁', '영업본부장');

-- 시드 데이터: 회의실 3개
insert into rooms (name) values
  ('면접실 A'),
  ('면접실 B'),
  ('면접실 C');
