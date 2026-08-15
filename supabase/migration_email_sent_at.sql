-- 메일 발송 성공 여부를 요청 단위로 기록 (Supabase SQL Editor에서 실행)
--
-- 지금까지는 "응답을 아직 안 했다"와 "메일 발송이 실제로 실패했다"를 구분할
-- 방법이 없었다 — 둘 다 그냥 "미응답"으로 보이고 "재발송" 버튼이 똑같이 떴다.
-- 실제로 발송이 성공했는지를 요청 행 자체에 기록해서, 채용담당자가 "아직 답을
-- 안 한 것"과 "애초에 메일을 못 받은 것"을 화면에서 구분할 수 있게 한다.

alter table response_requests add column if not exists email_sent_at timestamptz;

-- 이 컬럼이 생기기 전에 이미 만들어진 요청들은 email_sent_at이 전부 null이라, 그대로
-- 두면 실제로는 잘 발송됐던 것들까지 화면에서 전부 "발송 실패"로 잘못 보인다.
-- 과거 데이터는 "그 당시엔 발송된 것으로 간주"(생성 시각으로 채움)해서 오탐을 막는다.
-- 이후 새로 생기는 요청은 코드에서 실제 발송 성공 시에만 이 값을 채운다.
update response_requests set email_sent_at = created_at where email_sent_at is null;
