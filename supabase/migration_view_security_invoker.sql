-- 읽기용 뷰가 RLS를 우회하던 구멍 막기 (Supabase SQL Editor에서 실행)
--
-- 왜 필요한가
-- -----------
-- 네 테이블 모두 RLS를 켜고 정책을 하나도 두지 않아서, 공개 키(anon)로는 아무것도
-- 읽거나 쓸 수 없다. 모든 접근은 서비스 롤 키를 쓰는 /api/* 라우트를 거친다.
--
-- 그런데 뷰는 기본값이 "만든 사람 권한으로 실행"(security definer)이라 RLS를 건너뛴다.
-- 실제로 공개 키로 조회해보니 테이블은 전부 0행인데 rooms_readable은 3행이 그대로
-- 보였다(2026-09-27). 이 뷰처럼 단순한 뷰는 자동으로 수정 가능한 뷰가 되기도 해서,
-- 읽기뿐 아니라 공개 키로 회의실을 고치거나 지우는 경로가 될 수도 있었다.
--
-- 무엇을 하나
-- -----------
-- 1. security_invoker = on: 뷰를 "조회하는 사람 권한"으로 실행한다. 공개 키로 보면
--    밑의 테이블 RLS가 그대로 적용되어 0행이 된다.
-- 2. anon·authenticated의 뷰 권한 회수: 이 뷰들은 사람이 Table Editor에서 훑어보는
--    용도라 REST로 열어둘 이유가 없다. 1번이 풀려도 막히도록 한 겹 더 둔다.
--
-- Table Editor는 postgres 역할로 보므로 두 조치 후에도 지금처럼 보인다.
-- 앱 코드는 이 뷰를 쓰지 않으므로 순서 제약 없이 언제 실행해도 된다.
-- 여러 번 실행해도 결과가 같다. 없는 뷰는 건너뛴다.

do $$
declare
  v text;
begin
  foreach v in array array['rooms_readable', 'interviews_readable'] loop
    if exists (select 1 from pg_views where schemaname = 'public' and viewname = v) then
      execute format('alter view public.%I set (security_invoker = on)', v);
      execute format('revoke all on public.%I from anon, authenticated', v);
      raise notice '% : security_invoker 켜고 anon/authenticated 권한 회수', v;
    else
      raise notice '% : 없음 — 건너뜀', v;
    end if;
  end loop;
end $$;

-- 확인용: security_invoker=on 이 보이면 적용된 것이다.
select c.relname as view_name, c.reloptions
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'v';
