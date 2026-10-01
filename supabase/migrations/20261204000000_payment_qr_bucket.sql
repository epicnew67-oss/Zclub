-- Payment QR images for JazzCash / Easypaisa. The admin settings page
-- uploads directly to this bucket (no base64/data URLs), and the manual
-- top-up screen shows the public URL. Type + size limits are enforced by
-- the bucket itself, not just the client.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'payment-qr',
  'payment-qr',
  true,
  5242880,
  array['image/png', 'image/jpeg', 'image/webp']
)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- Public read: customers load the QR on the manual payment screen.
create policy "payment_qr_public_read"
  on storage.objects for select
  using (bucket_id = 'payment-qr');

create policy "payment_qr_staff_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'payment-qr'
    and (
      public.user_has_role('owner'::public.user_role)
      or public.user_has_role('finance'::public.user_role)
    )
  );

create policy "payment_qr_staff_update"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'payment-qr'
    and (
      public.user_has_role('owner'::public.user_role)
      or public.user_has_role('finance'::public.user_role)
    )
  );

create policy "payment_qr_staff_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'payment-qr'
    and (
      public.user_has_role('owner'::public.user_role)
      or public.user_has_role('finance'::public.user_role)
    )
  );
