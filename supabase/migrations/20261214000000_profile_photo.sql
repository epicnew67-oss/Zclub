-- A signed-in user can choose an image they uploaded in their own folder.
-- Keep the account and seller-facing avatar in sync in one transaction.
create or replace function public.set_own_profile_photo(_path text)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Sign in required' using errcode = 'insufficient_privilege';
  end if;
  if _path is null or (storage.foldername(_path))[1] <> v_actor::text
     or _path !~* '\.(jpe?g|png|webp)$'
     or not exists (
       select 1 from storage.objects
       where bucket_id = 'seller-avatars' and name = _path
         and metadata->>'mimetype' in ('image/jpeg', 'image/png', 'image/webp')
     ) then
    raise exception 'Choose a photo you uploaded to your account'
      using errcode = 'invalid_parameter_value';
  end if;

  update public.profiles set avatar_url = _path where id = v_actor;
  update public.seller_profiles set avatar_url = _path
    where user_id = v_actor and soft_deleted_at is null;
  return true;
end;
$$;
revoke all on function public.set_own_profile_photo(text) from public, anon;
grant execute on function public.set_own_profile_photo(text) to authenticated;
