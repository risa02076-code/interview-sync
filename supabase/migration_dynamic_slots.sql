-- 슬롯 표현 방식을 "인덱스(정수)" 에서 "실제 ISO 날짜시각 문자열"로 변경한다.
-- 기존 인덱스 기반 테스트 데이터는 새 방식과 의미가 맞지 않으므로 초기화한다.

delete from response_requests;
delete from interviews;

alter table interviewers alter column busy_slots type text[] using array[]::text[];
alter table rooms alter column busy_slots type text[] using array[]::text[];
alter table interviews alter column preferred_slots type text[] using array[]::text[];
alter table interviews alter column matched_slot type text using matched_slot::text;
