-- 메일 발송 성공 여부를 요청 단위로 기록 (Supabase SQL Editor에서 실행)
--
-- 지금까지는 "응답을 아직 안 했다"와 "메일 발송이 실제로 실패했다"를 구분할
-- 방법이 없었다 — 둘 다 그냥 "미응답"으로 보이고 "재발송" 버튼이 똑같이 떴다.
-- 실제로 발송이 성공했는지를 요청 행 자체에 기록해서, 채용담당자가 "아직 답을
-- 안 한 것"과 "애초에 메일을 못 받은 것"을 화면에서 구분할 수 있게 한다.

alter table response_requests add column if not exists email_sent_at timestamptz;
