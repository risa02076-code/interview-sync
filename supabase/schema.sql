-- 인터뷰싱크 스키마 (Supabase SQL Editor에 붙여넣어 실행)

create extension if not exists pgcrypto;

create table if not exists interviewers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null,
  busy_slots int[] not null default '{}'
);

create table if not exists rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  busy_slots int[] not null default '{}'
);

create table if not exists interviews (
  id uuid primary key default gen_random_uuid(),
  candidate_name text not null,
  position text not null,
  panel uuid[] not null default '{}',
  preferred_slots int[] not null default '{}',
  matched_slot int,
  room_id uuid references rooms(id),
  status text not null default 'pending',
  note text,
  created_at timestamptz not null default now()
);

-- RLS 활성화, 정책은 만들지 않음 (API 라우트가 서비스 롤 키로만 접근 — 브라우저 직접 접근 차단)
alter table interviewers enable row level security;
alter table rooms enable row level security;
alter table interviews enable row level security;

-- 시드 데이터: 면접관 8명 (프로토타입과 동일한 가용시간 패턴)
insert into interviewers (name, role, busy_slots) values
  ('이서연', '백엔드팀장', '{1,3,5,7,9}'),
  ('박준혁', '백엔드 시니어', '{2,3,6,7}'),
  ('정민지', 'PM 리드', '{0,1,2,4,5,6,7,8}'),
  ('오세훈', '디자인 리드', '{0,1,2,3,9}'),
  ('한지우', '분석팀장', '{5,6}'),
  ('윤서아', '시니어 분석가', '{0,4,8}'),
  ('배지훈', '시니어 디자이너', '{3,4,5}'),
  ('신동혁', '영업본부장', '{1,2,3,4,5,6,7,8}');

-- 시드 데이터: 회의실 3개
insert into rooms (name, busy_slots) values
  ('면접실 A', '{1,3,5,7,9}'),
  ('면접실 B', '{0,2,4,6,8}'),
  ('면접실 C', '{}');
