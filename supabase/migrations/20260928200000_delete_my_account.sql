-- "Delete account" in the app (js/account.js): a signed-in user deletes
-- their own account, and only their own. Supabase keeps auth.users out of
-- the client's reach; this function reaches it with the owner's rights
-- (security definer) for exactly one row: the caller's (auth.uid()).
-- Their sessions, refresh tokens and identities go with it (foreign keys
-- on delete cascade).
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;
  delete from auth.users where id = auth.uid();
end;
$$;

-- only a signed-in user may call it; not the anonymous key
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
