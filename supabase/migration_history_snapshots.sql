-- 응답 히스토리 스냅샷 마이그레이션 (Supabase SQL Editor에서 실행)
--
-- 지금까지는 면접관이 "불가능한 시간"을 다시 제출하면 이전 값을 덮어써서, 나중에
-- "그때는 뭐라고 답했었는지"를 알 수 없었다. 후보자의 순위 제출도 마찬가지로
-- interviews.preferred_slots 하나만 갱신돼서 이전 라운드 기록이 사라졌다.
-- 응답을 제출하는 순간의 답변을 response_requests 행 자체에 스냅샷으로 남겨서,
-- 채용 매니저가 나중에 전체 히스토리를 볼 수 있게 한다.

-- (지난번 마이그레이션에서 answered_slots를 이미 추가했다면 아래 줄은 그냥 무시됩니다 —
-- if not exists라서 두 번 실행해도 안전합니다.)
alter table response_requests add column if not exists answered_slots text[];
alter table response_requests add column if not exists answered_busy_slots text[];
alter table response_requests add column if not exists answered_preferred_slots text[];
