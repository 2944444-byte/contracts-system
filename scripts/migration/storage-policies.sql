-- Storage policies of the source project (ndvcqgrpsqykhodiyrhx), extracted from pg_policies on 4.9.2026.
-- These are NOT part of a regular `supabase db dump` and must be recreated on the target project.
-- Verify afterwards: select count(*) from pg_policies where schemaname='storage';  -- expected 9

create policy "Authenticated delete documents" on storage.objects as permissive for DELETE to authenticated using ((bucket_id = 'documents'::text));
create policy "Authenticated delete logos" on storage.objects as permissive for DELETE to public using ((bucket_id = 'logos'::text));
create policy "Authenticated delete revenue_attachments" on storage.objects as permissive for DELETE to authenticated using ((bucket_id = 'revenue_attachments'::text));
create policy "Authenticated update documents" on storage.objects as permissive for UPDATE to authenticated using ((bucket_id = 'documents'::text));
create policy "Authenticated update logos" on storage.objects as permissive for UPDATE to public using ((bucket_id = 'logos'::text));
create policy "Authenticated update revenue_attachments" on storage.objects as permissive for UPDATE to authenticated using ((bucket_id = 'revenue_attachments'::text));
create policy "Authenticated upload documents" on storage.objects as permissive for INSERT to authenticated with check ((bucket_id = 'documents'::text));
create policy "Authenticated upload logos" on storage.objects as permissive for INSERT to public with check ((bucket_id = 'logos'::text));
create policy "Authenticated upload revenue_attachments" on storage.objects as permissive for INSERT to authenticated with check ((bucket_id = 'revenue_attachments'::text));
