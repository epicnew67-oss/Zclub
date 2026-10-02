-- Reject active content and oversized uploads at the storage boundary.
-- Browser file picker restrictions alone can be bypassed.
update storage.buckets
set file_size_limit = 5242880,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
where id in ('listing-photos', 'seller-avatars');

drop policy if exists "listing_photos_storage_insert_own" on storage.objects;
create policy "listing_photos_storage_insert_own"
  on storage.objects for insert to authenticated with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~* '\.(jpe?g|png|webp)$'
  );

drop policy if exists "listing_photos_storage_update_own" on storage.objects;
create policy "listing_photos_storage_update_own"
  on storage.objects for update to authenticated using (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'listing-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~* '\.(jpe?g|png|webp)$'
  );

drop policy if exists "seller_avatars_insert_own" on storage.objects;
create policy "seller_avatars_insert_own"
  on storage.objects for insert to authenticated with check (
    bucket_id = 'seller-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~* '\.(jpe?g|png|webp)$'
  );

drop policy if exists "seller_avatars_update_own" on storage.objects;
create policy "seller_avatars_update_own"
  on storage.objects for update to authenticated using (
    bucket_id = 'seller-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  ) with check (
    bucket_id = 'seller-avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
    and name ~* '\.(jpe?g|png|webp)$'
  );
