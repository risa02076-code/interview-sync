-- 충돌 최소 시간 추천 마이그레이션 (Supabase SQL Editor에서 실행)
--
-- 면접관 전원의 가능 시간 데이터를 바탕으로 계산한 "충돌이 가장 적은 시간(들)"을
-- 후보자 안내 시점에 고정해서 저장한다. 저장해두지 않으면 후보자가 링크를 다시
-- 열어봤을 때, 그 사이 바뀐 면접관 가용 시간으로 다시 계산되어 이메일로 안내한
-- 시간과 화면에 보이는 시간이 달라질 수 있다.
--
-- 전원 동시 가능한 시간이 여러 개일 수 있어 배열(text[])로 저장한다.

alter table interviews add column if not exists recommended_slots text[] not null default '{}';
