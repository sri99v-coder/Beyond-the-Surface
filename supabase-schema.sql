create extension if not exists pgcrypto;

-- The editor ID is not an email address; keep contributor emails private in story_contacts.

create table if not exists public.stories (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) between 1 and 120),
  body text not null check (char_length(body) between 1 and 200000),
  author_name text not null check (char_length(author_name) between 1 and 80),
  contributor_photo_url text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists public.story_contacts (
  story_id uuid primary key references public.stories(id) on delete cascade,
  contributor_email text not null check (char_length(contributor_email) between 3 and 254)
);

alter table public.stories enable row level security;
alter table public.story_contacts enable row level security;

revoke all on public.stories from anon, authenticated;
revoke all on public.story_contacts from anon, authenticated;
grant select on public.stories to anon, authenticated;

drop policy if exists "Anyone can read approved stories" on public.stories;
create policy "Anyone can read approved stories"
  on public.stories for select to anon, authenticated
  using (status = 'approved');

drop policy if exists "Editor can read all stories" on public.stories;
create policy "Editor can read all stories"
  on public.stories for select to authenticated
  using (auth.uid() = 'b7bb376f-5688-4952-8e8d-08a1d6a466c6'::uuid);

create or replace function public.submit_story(
  story_title text,
  story_body text,
  contributor_name text,
  contributor_email text,
  contributor_photo_url text default ''
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_story_id uuid;
begin
  if char_length(trim(story_title)) not between 1 and 120
     or char_length(story_body) not between 1 and 200000
     or char_length(trim(contributor_name)) not between 1 and 80
     or char_length(trim(contributor_email)) not between 3 and 254
     or char_length(coalesce(contributor_photo_url, '')) > 2048 then
    raise exception 'Invalid story submission';
  end if;

  insert into public.stories (title, body, author_name, contributor_photo_url)
  values (
    trim(story_title),
    story_body,
    trim(contributor_name),
    coalesce(contributor_photo_url, '')
  )
  returning id into new_story_id;

  insert into public.story_contacts (story_id, contributor_email)
  values (new_story_id, lower(trim(contributor_email)));

  return new_story_id;
end;
$$;

revoke all on function public.submit_story(text, text, text, text, text) from public;
grant execute on function public.submit_story(text, text, text, text, text) to anon, authenticated;

create or replace function public.list_pending_stories()
returns table (
  id uuid,
  title text,
  body text,
  author_name text,
  contributor_photo_url text,
  created_at timestamptz,
  contact_email text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is distinct from 'b7bb376f-5688-4952-8e8d-08a1d6a466c6'::uuid then
    raise exception 'Not authorized';
  end if;

  return query
  select s.id, s.title, s.body, s.author_name, s.contributor_photo_url, s.created_at, c.contributor_email
  from public.stories s
  join public.story_contacts c on c.story_id = s.id
  where s.status = 'pending'
  order by s.created_at asc;
end;
$$;

revoke all on function public.list_pending_stories() from public;
grant execute on function public.list_pending_stories() to authenticated;

create or replace function public.review_story(story_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is distinct from 'b7bb376f-5688-4952-8e8d-08a1d6a466c6'::uuid
     or new_status not in ('approved', 'rejected') then
    raise exception 'Not authorized';
  end if;

  update public.stories
  set status = new_status
  where id = story_id and status = 'pending';

  if not found then
    raise exception 'Pending story not found';
  end if;
end;
$$;

revoke all on function public.review_story(uuid, text) from public;
grant execute on function public.review_story(uuid, text) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('story-photos', 'story-photos', true, 1048576, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Anyone can upload story profile photos" on storage.objects;
create policy "Anyone can upload story profile photos"
  on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'story-photos');

drop policy if exists "Story profile photos are public" on storage.objects;
create policy "Story profile photos are public"
  on storage.objects for select to public
  using (bucket_id = 'story-photos');
