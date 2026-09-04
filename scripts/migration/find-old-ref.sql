-- Verification: how many rows in ANY text/json column of the public schema still contain the old project ref.
-- Expected after rewrite-urls.sql: zero rows returned.
with c as (
  select table_name n, column_name col from information_schema.columns
  where table_schema='public' and data_type in ('text','character varying','json','jsonb')
    and table_name in (select table_name from information_schema.tables where table_schema='public' and table_type='BASE TABLE')
)
select n as table_name, col as column_name,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I where %I::text like %L', n, col, '%ndvcqgrpsqykhodiyrhx%'), false, true, '')))[1]::text::int as rows_with_old_ref
from c
where (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I where %I::text like %L', n, col, '%ndvcqgrpsqykhodiyrhx%'), false, true, '')))[1]::text::int > 0
order by 1,2;
