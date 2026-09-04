-- Rewrite stored Storage URLs from the old project ref to the new one.
-- MUST run with triggers disabled (session_replication_role = replica) so the row_history
-- triggers do not record these technical updates and the fingerprints stay comparable:
--   psql --single-transaction --variable ON_ERROR_STOP=1 \
--     --command 'SET session_replication_role = replica' --file rewrite-urls.sql --dbname "$NEW_DB_URL"
-- Placeholders: __OLD__ = ndvcqgrpsqykhodiyrhx, __NEW__ = mjsyjnlmjwdeykezxmul (substituted before running).

update companies set logo_url = replace(logo_url, '__OLD__', '__NEW__') where logo_url like '%__OLD__%';
update companies set signature_url = replace(signature_url, '__OLD__', '__NEW__') where signature_url like '%__OLD__%';
update insurances_tenant set certificate_url = replace(certificate_url, '__OLD__', '__NEW__') where certificate_url like '%__OLD__%';
update insurances_tenant set documents = replace(documents::text, '__OLD__', '__NEW__')::jsonb where documents::text like '%__OLD__%';
update insurances_building set document_url = replace(document_url, '__OLD__', '__NEW__') where document_url like '%__OLD__%';
update insurances_building set documents = replace(documents::text, '__OLD__', '__NEW__')::jsonb where documents::text like '%__OLD__%';
update guarantees set document_url = replace(document_url, '__OLD__', '__NEW__') where document_url like '%__OLD__%';
update guarantees set documents = replace(documents::text, '__OLD__', '__NEW__')::jsonb where documents::text like '%__OLD__%';
update safety_inspections set document_url = replace(document_url, '__OLD__', '__NEW__') where document_url like '%__OLD__%';
update safety_inspections set documents = replace(documents::text, '__OLD__', '__NEW__')::jsonb where documents::text like '%__OLD__%';
update contracts set document_url = replace(document_url, '__OLD__', '__NEW__') where document_url like '%__OLD__%';
update concessions set document_url = replace(document_url, '__OLD__', '__NEW__') where document_url like '%__OLD__%';
update documents set file_url = replace(file_url, '__OLD__', '__NEW__') where file_url like '%__OLD__%';
update documents set external_url = replace(external_url, '__OLD__', '__NEW__') where external_url like '%__OLD__%';
update revenue_reports set attachment_url = replace(attachment_url, '__OLD__', '__NEW__') where attachment_url like '%__OLD__%';
update revenue_reports set attachment_path = replace(attachment_path, '__OLD__', '__NEW__') where attachment_path like '%__OLD__%';
update letters set pdf_url = replace(pdf_url, '__OLD__', '__NEW__') where pdf_url like '%__OLD__%';
update letters set content_json = replace(content_json::text, '__OLD__', '__NEW__')::jsonb where content_json::text like '%__OLD__%';
update row_history set old_data = replace(old_data::text, '__OLD__', '__NEW__')::jsonb where old_data::text like '%__OLD__%';
update audit_log set new_value = replace(new_value::text, '__OLD__', '__NEW__')::jsonb where new_value::text like '%__OLD__%';
