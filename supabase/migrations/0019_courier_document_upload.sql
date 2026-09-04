drop policy if exists "upload own courier documents" on public.courier_documents;

revoke insert on public.courier_documents from anon, authenticated;

create or replace function public.submit_courier_document(
  p_kind public.courier_document_kind,
  p_storage_path text
)
returns public.courier_documents
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_document public.courier_documents;
begin
  if v_user_id is null then
    raise exception 'You must be signed in' using errcode = '28000';
  end if;

  if not exists (select 1 from public.couriers where id = v_user_id) then
    raise exception 'You are not registered as a courier' using errcode = '42501';
  end if;

  if p_storage_path is null
     or split_part(p_storage_path, '/', 1) <> v_user_id::text then
    raise exception 'A document has to be uploaded to your own folder' using errcode = '42501';
  end if;

  insert into public.courier_documents (courier_id, kind, storage_path, status)
  values (v_user_id, p_kind, p_storage_path, 'pending')
  on conflict (courier_id, kind) do update
    set storage_path = excluded.storage_path,
        status = 'pending',
        reviewed_by = null,
        reviewed_at = null,
        notes = null
  returning * into v_document;

  update public.couriers
     set verification_status = 'pending',
         verification_notes = null
   where id = v_user_id
     and verification_status = 'rejected';

  return v_document;
end;
$$;

revoke all on function public.submit_courier_document(public.courier_document_kind, text)
  from public, anon;
grant execute on function public.submit_courier_document(public.courier_document_kind, text)
  to authenticated;

drop policy if exists "courier replaces own documents" on storage.objects;
create policy "courier replaces own documents" on storage.objects
  for update using (
    bucket_id = 'courier-documents'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'courier-documents'
    and split_part(name, '/', 1) = auth.uid()::text
  );
