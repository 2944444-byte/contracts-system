-- Database fingerprint: row count + content md5 per table, sequences, money sums, schema-object counts.
-- Run the SAME query on source and target; every row must match.
-- __REF__ is the project ref of the database being fingerprinted (old: ndvcqgrpsqykhodiyrhx, new: mjsyjnlmjwdeykezxmul).
-- Stored storage URLs embed the ref, so it is normalised to 'REF' before hashing.
with t as (
  select table_schema s, table_name n from information_schema.tables
  where table_type='BASE TABLE'
    and (table_schema='public'
      or (table_schema='auth' and table_name in ('users','identities'))
      or (table_schema='storage' and table_name in ('buckets','objects')))
)
select s||'.'||n as tbl,
  (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from %I.%I', s, n), false, true, '')))[1]::text::bigint as cnt,
  (xpath('/row/h/text()', query_to_xml(format(
     'select coalesce(md5(string_agg(replace(x::text, %L, ''REF''), '','' order by replace(x::text, %L, ''REF''))), ''empty'') as h from %I.%I x',
     '__REF__', '__REF__', s, n), false, true, '')))[1]::text as h
from t
union all select 'seq:row_history_id_seq', last_value, null from pg_sequences where sequencename='row_history_id_seq'
union all select 'seq:cpi_link_coefficients_id_seq', last_value, null from pg_sequences where sequencename='cpi_link_coefficients_id_seq'
union all select 'sum:charges.total_amount', null, sum(total_amount)::text from charges
union all select 'sum:advance_payments.total_with_vat', null, sum(total_with_vat)::text from advance_payments
union all select 'meta:rls_policies', count(*), null from pg_policies where schemaname='public'
union all select 'meta:storage_policies', count(*), null from pg_policies where schemaname='storage'
union all select 'meta:functions', count(*), null from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace where ns.nspname='public'
union all select 'meta:triggers', count(*), null from pg_trigger tg join pg_class c on c.oid=tg.tgrelid join pg_namespace ns on ns.oid=c.relnamespace where ns.nspname='public' and not tg.tgisinternal
union all select 'meta:views', count(*), null from pg_views where schemaname='public'
union all select 'meta:migrations', count(*), null from supabase_migrations.schema_migrations
order by 1;
