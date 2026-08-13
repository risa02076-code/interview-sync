-- 면접관 응답 기록 마이그레이션 (Supabase SQL Editor에서 실행)
--
-- priority_confirm 요청에 면접관이 실제로 "참석 가능"이라고 답한 시간들을 그대로
-- 저장해둔다. 지금까지는 그 답변을 busy_slots에만 반영하고 따로 기록하지 않아서,
-- 나중에 캘린더가 또 바뀌면 "그때 뭐라고 답했는지"를 알 수 없었다.

alter table response_requests add column if not exists answered_slots text[];
