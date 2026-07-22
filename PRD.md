# PRD — 인터뷰싱크 (Interview Sync)

면접 일정 자동 매칭 서비스

## 1. 문제 정의

채용팀 리크루터는 패널 면접(면접관 2인 이상) 일정을 잡을 때마다 면접관 전원의 가능 시간을 취합하고, 후보자에게 안내하고, 회의실을 확인하고, 확정 후 리마인드를 보내는 과정을 매번 수작업으로 반복한다. 특히 확정된 면접의 면접관 일정이 바뀌면 이 과정을 처음부터 다시 밟아야 해서, 채용 규모가 커질수록 리크루터의 반복 업무 시간이 비례해서 늘어난다.

이 서비스는 **면접관 → 후보자 순서로 가능 시간을 자동 수합**하고, 그 결과를 **자동으로 대조**해 면접 일정을 확정하며, 확정 후 조건이 바뀌면 **자동으로 재조율**하고, 매칭이 불가능한 경우에만 리크루터가 직접 개입하도록 만들어 반복 업무 시간을 줄이는 것을 목표로 한다.

## 2. 타겟 유저

- **주 사용자**: 채용팀 리크루터 — 후보자를 등록하면 이후 전 과정(문의 발송·수합·매칭)이 자동으로 진행되고, 예외 상황(에스컬레이션)에만 개입한다.
- **간접 사용자**: 면접관 · 후보자 — 이메일로 받은 링크에서 가능/불가능 시간을 제출한다. 별도 로그인 없이 토큰 기반 링크로만 접근한다.

## 3. 핵심 기능 (MVP)

| # | 기능 | 설명 |
|---|------|------|
| 1 | 후보자 등록 | 이름 · 이메일 · 지원 직무 · 면접 패널(2인 이상)을 입력하면 케이스가 생성된다 |
| 2 | 면접관 문의 자동 발송 | 등록 즉시 패널 전원에게 "불가능한 시간"을 묻는 이메일이 자동 발송된다 |
| 3 | 면접관 응답 → 후보자 자동 발송 | 패널 전원이 응답을 마치면, 이미 불가능하다고 확인된 시간을 제외한 나머지만 후보자에게 자동 발송된다 |
| 4 | 후보자 응답 → 자동 매칭 | 후보자가 희망 시간을 제출하면 그 자리에서 패널·회의실 가용성을 대조해 확정한다 |
| 5 | 매칭 실패 시 에스컬레이션 | 공통 가능 시간이 없으면 사유와 함께 "리크루터 확인 필요" 상태로 표시한다 |
| 6 | 동적 슬롯 생성 | 하드코딩된 날짜 대신, 요청 시점 기준 다음 영업일 5일을 매번 새로 계산해 제안한다 |
| 7 | 자동 재조율 | 확정된 면접의 면접관 일정이 바뀌면, 전체 시간대를 다시 탐색해 대체 시간을 자동으로 확정한다 |
| 8 | 조율 대시보드 | 전체 면접 케이스를 표로 한눈에 확인(후보자·직무·패널·진행단계·매칭결과), CSV로 내보낸다 |
| 9 | 면접관 관리 | 면접관별 이메일 등록, 현재 불가능 시간 확인, 개별 문의 메일 재발송 |
| 10 | 케이스 삭제 | 취소된 면접 건을 목록에서 제거한다 |

## 4. 화면 구성

| 화면 | 경로 | 설명 |
|------|------|------|
| 조율 대시보드 (목록) | `/interviews` | 전체 면접 케이스를 표로 표시, 진행 단계·매칭 결과, 상세 화면 링크, 삭제, CSV 내보내기 |
| 후보자 등록 (입력 폼) | `/interviews/new` | 이름 · 이메일 · 직무 · 패널 선택 후 제출 → 면접관 문의 자동 발송 → 대시보드로 이동 |
| 케이스 상세 | `/interviews/[id]` | 진행 단계, 확정 정보 또는 에스컬레이션 사유 표시, 재조율 시뮬레이션 버튼, 발송 실패 시 수동 재발송 버튼 |
| 면접관 관리 | `/interviewers` | 면접관별 이메일 등록·현재 불가능 시간 확인·문의 메일 발송 |
| 응답 폼 (공개, 비로그인) | `/respond/[token]` | 면접관/후보자가 이메일 링크로 접속해 가능/불가능 시간을 선택 제출 |

## 5. 진행 단계 (stage)

면접관 → 후보자 순서를 시스템이 강제하기 위해, 각 케이스는 아래 단계를 순서대로 지난다.

`created` (등록됨) → `interviewer_pending` (면접관 응답 대기) → `interviewer_done` (면접관 응답 완료, 후보자 자동 발송 트리거) → `candidate_pending` (후보자 응답 대기) → `candidate_done` (매칭 실행 완료)

## 6. 데이터 구조

```
interviewers (면접관)
  id            uuid, PK
  name          text
  role          text            -- 예: "백엔드팀장"
  email         text, null
  busy_slots    text[]          -- 불가능하다고 응답한 슬롯(ISO 날짜시각 문자열) 목록

rooms (회의실)
  id            uuid, PK
  name          text
  busy_slots    text[]

interviews (면접 케이스)
  id                 uuid, PK
  candidate_name     text
  candidate_email    text, null
  position           text
  panel              uuid[]     -- interviewers.id 참조 목록
  preferred_slots    text[]     -- 후보자가 제출한 희망 슬롯
  matched_slot       text, null
  room_id            uuid, FK -> rooms.id, null
  status             text       -- 'confirmed' | 'escalated' | 'pending' | 'rescheduled'
  stage              text       -- 진행 단계 (5번 참고)
  note               text, null
  created_at         timestamptz, default now()

response_requests (이메일 응답 요청 — 토큰 기반)
  id                uuid, PK
  token             text, unique   -- 응답 링크에 포함되는 값
  kind              text           -- 'interviewer' | 'candidate'
  interview_id       uuid, FK -> interviews.id, null
  interviewer_id     uuid, FK -> interviewers.id, null
  status            text          -- 'pending' | 'submitted'
  created_at        timestamptz
  submitted_at      timestamptz, null
```

슬롯은 고정된 날짜 목록이 아니라, 요청 시점 기준 "다음 영업일(주말 제외) 5일 × 하루 2타임"을 매번 계산해 ISO 날짜시각 문자열로 표현한다 (`lib/slots.ts`의 `generateUpcomingSlots`). `interviewers.busy_slots` / `rooms.busy_slots` / `interviews.preferred_slots` / `matched_slot` 은 모두 이 문자열 값을 공유한다.
