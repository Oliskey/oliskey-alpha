-- Delete account (owner decision 2026-10-30): users must withdraw all real money first; trade and money records
-- are kept (regulators), so "delete" anonymises the person and leaves the ledger intact.

alter table public.profiles add column if not exists deleted_at timestamptz;

create or replace function public.close_account(p_user_id uuid)
returns public.profiles
language plpgsql security definer set search_path = public as $$
declare
  v_prof profiles;
  v_demo accounts;
begin
  select * into v_prof from profiles where id = p_user_id for update;
  if not found then raise exception 'ACCOUNT_NOT_FOUND'; end if;
  if v_prof.deleted_at is not null then return v_prof; end if;

  perform 1 from accounts where user_id = p_user_id for update;
  if exists (select 1 from trades where user_id = p_user_id and status = 'open') then
    raise exception 'ACCOUNT_HAS_OPEN_TRADES';
  end if;
  if exists (select 1 from accounts where user_id = p_user_id and type <> 'DEMO' and (balance <> 0 or locked <> 0))
     or exists (select 1 from transactions where user_id = p_user_id and type = 'withdrawal' and status = 'pending') then
    raise exception 'WITHDRAW_FUNDS_FIRST';
  end if;

  -- Demo credits are not money; zero them through the ledger so balance = sum(ledger) still holds.
  select * into v_demo from accounts where user_id = p_user_id and type = 'DEMO';
  if found and v_demo.balance <> 0 then
    insert into transactions (user_id, account_id, type, amount, balance_after, completed_at, metadata)
    values (p_user_id, v_demo.id, 'demo_reset', -v_demo.balance, 0, now(), '{"reason":"account_deleted"}');
    update accounts set balance = 0 where id = v_demo.id;
  end if;

  update auth.users set email = 'deleted-' || p_user_id || '@deleted.invalid', encrypted_password = null,
                        raw_user_meta_data = '{}'::jsonb
  where id = p_user_id;
  delete from admin_mfa where user_id = p_user_id;
  delete from notifications where user_id = p_user_id;
  delete from user_tasks where user_id = p_user_id;
  update profiles set full_name = null, phone = null, is_admin = false, deleted_at = now()
  where id = p_user_id returning * into v_prof;
  return v_prof;
end $$;

revoke execute on function public.close_account(uuid) from public, anon, authenticated;
grant execute on function public.close_account(uuid) to service_role;
