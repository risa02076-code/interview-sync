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
  -- stage: 'created' | 'interviewer_pending' | 'interviewer_done' | 'candidate_pending'
  --        | 'candidate_done' | 'priority_confirm_pending'
  stage text not null default 'created',
  confirmation_sent_at timestamptz,
  -- 면접 전날 리마인드 메일 발송 시각 (케이스당 1회만 발송)
  day_before_reminded_at timestamptz,
  -- 후보자에게 안내한(안내할) 충돌 최소 추천 시간들. 안내 시점에 고정해서 저장한다.
  recommended_slots text[] not null default '{}',
  -- 면접관 전원 동시 가능 시간이 없어 조회 기간을 넓혀 재문의한 횟수(1부터 시작).
  -- 상한(MAX_AVAILABILITY_ROUNDS) 넘으면 후보자 안내 없이 escalated로 리크루터에게 넘긴다.
  availability_round int not null default 1,
  -- 후보자가 "이 시간엔 참석이 어렵다"며 일정 변경을 요청한 시간들. 재조율 시
  -- 추천/제안 후보에서 항상 제외한다(같은 시간을 다시 제안하는 것을 막기 위함).
  excluded_slots text[] not null default '{}',
  note text,
  created_at timestamptz not null default now()
);

create table if not exists response_requests (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  kind text not null, -- 'candidate' | 'interviewer' | 'priority_confirm'
  interview_id uuid references interviews(id) on delete cascade,
  interviewer_id uuid references interviewers(id) on delete cascade,
  status text not null default 'pending', -- 'pending' | 'submitted'
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  -- 미응답 독촉 메일 발송 이력 (마지막 발송 시각 / 누적 횟수)
  reminded_at timestamptz,
  reminder_count int not null default 0,
  -- kind='priority_confirm'일 때만 사용: 후보자가 제출한 1~3순위 중 이 면접관에게
  -- 참석 가능 여부를 물어본 시간들(발송 시점에 고정)
  confirm_slots text[],
  -- kind='priority_confirm'일 때만 사용: confirm_slots 중 실제로 참석 가능하다고 답한
  -- 시간들. busy_slots는 그 뒤에도 계속 바뀔 수 있어서, "그때 무엇을 답했는지" 기록을
  -- 따로 남겨둔다(리크루터가 나중에 확인할 수 있도록).
  answered_slots text[],
  -- kind='interviewer'일 때만 사용: 이 라운드에 실제로 제출한 "불가능한 시간" 스냅샷.
  -- interviewers.busy_slots는 다음 라운드에 덮어써지므로, 각 라운드에 뭐라고
  -- 답했었는지 히스토리를 보려면 이 스냅샷이 필요하다.
  answered_busy_slots text[],
  -- kind='candidate'일 때만 사용: 이때 실제로 제출한 1~3순위 스냅샷.
  -- interviews.preferred_slots는 재조율 시 초기화되므로 마찬가지로 별도 보관.
  answered_preferred_slots text[]
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
