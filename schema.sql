-- =====================================================================
-- Campus Event Portal – Supabase schema
-- Paste this whole file into: Supabase Dashboard → SQL Editor → New query → Run
-- Safe to re-run (uses IF NOT EXISTS / OR REPLACE / ON CONFLICT).
-- =====================================================================

-- ---------- 1. EVENTS ------------------------------------------------
create table if not exists public.events (
  id                 text primary key,
  title              text        not null,
  category           text        not null check (category in ('Workshop','Seminar','Fest','Competition')),
  event_date         date        not null,
  time_label         text        not null,
  venue              text        not null,
  description        text        not null default '',
  seats              integer     not null check (seats > 0),
  -- seats already taken outside this portal (the "registered" numbers from your demo data)
  initial_registered integer     not null default 0 check (initial_registered >= 0),
  eligibility        text        not null default 'Open to all',
  created_at         timestamptz not null default now()
);

-- ---------- 2. REGISTRATIONS -----------------------------------------
create table if not exists public.registrations (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid() references auth.users(id) on delete cascade,
  event_id    text not null references public.events(id) on delete cascade,
  full_name   text not null check (char_length(btrim(full_name)) between 3 and 100),
  student_id  text not null check (char_length(btrim(student_id)) between 4 and 30),
  email       text not null check (email ~* '^[^\s@]+@[^\s@]+\.[^\s@]+$' and char_length(email) <= 254),
  phone       text not null check (phone ~ '^[6-9][0-9]{9}$'),
  department  text check (department is null or char_length(department) <= 60),
  created_at  timestamptz not null default now()
);

-- One registration per browser-user per event, and one per student ID per event
create unique index if not exists registrations_user_event_uq
  on public.registrations (user_id, event_id);
create unique index if not exists registrations_student_event_uq
  on public.registrations (event_id, lower(btrim(student_id)));
create index if not exists registrations_user_idx  on public.registrations (user_id);
create index if not exists registrations_event_idx on public.registrations (event_id);

-- ---------- 3. SEAT-LIMIT TRIGGER (prevents overbooking) -------------
create or replace function public.enforce_event_capacity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_seats   integer;
  v_initial integer;
  v_taken   integer;
begin
  -- lock the event row so two simultaneous sign-ups can't both grab the last seat
  select seats, initial_registered
    into v_seats, v_initial
    from public.events
   where id = new.event_id
   for update;

  if not found then
    raise exception 'EVENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  select count(*) into v_taken
    from public.registrations
   where event_id = new.event_id;

  if v_initial + v_taken >= v_seats then
    raise exception 'EVENT_FULL' using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_event_capacity() from public, anon, authenticated;

drop trigger if exists trg_enforce_event_capacity on public.registrations;
create trigger trg_enforce_event_capacity
  before insert on public.registrations
  for each row execute function public.enforce_event_capacity();

-- ---------- 4. PUBLIC EVENT LIST WITH LIVE SEAT COUNTS ---------------
-- Registrations are private (RLS), so the live seat count is exposed
-- through this function, which returns counts only – no personal data.
create or replace function public.list_events()
returns table (
  id text, title text, category text, event_date date, time_label text,
  venue text, description text, seats integer, registered integer, eligibility text
)
language sql
stable
security definer
set search_path = ''
as $$
  select e.id, e.title, e.category, e.event_date, e.time_label, e.venue,
         e.description, e.seats,
         least(e.seats, e.initial_registered + coalesce(r.cnt, 0))::integer as registered,
         e.eligibility
    from public.events e
    left join (select event_id, count(*)::integer as cnt
                 from public.registrations group by event_id) r
           on r.event_id = e.id
   order by e.event_date, e.id;
$$;

revoke all on function public.list_events() from public;
grant execute on function public.list_events() to anon, authenticated;

-- ---------- 5. ROW LEVEL SECURITY ------------------------------------
alter table public.events        enable row level security;
alter table public.registrations enable row level security;

-- Events: everyone can read, nobody can write from the browser
drop policy if exists "events are readable by everyone" on public.events;
create policy "events are readable by everyone"
  on public.events for select
  to anon, authenticated
  using (true);

-- Registrations: each visitor can only see / create / cancel their own
drop policy if exists "users read own registrations"   on public.registrations;
drop policy if exists "users create own registrations" on public.registrations;
drop policy if exists "users cancel own registrations" on public.registrations;

create policy "users read own registrations"
  on public.registrations for select
    to anon, authenticated    
  using (user_id = (select auth.uid()));

create policy "users create own registrations"
  on public.registrations for insert
  to anon, authenticated
  with check (user_id = (select auth.uid()));

create policy "users cancel own registrations"
  on public.registrations for delete
  to anon, authenticated
  using (user_id = (select auth.uid()));

-- No UPDATE policy on purpose: to change details, cancel and re-register.

-- ---------- 6. SEED EVENTS (from your demo data) ---------------------
insert into public.events
  (id, title, category, event_date, time_label, venue, description, seats, initial_registered, eligibility)
values
  ('evt-001','Full-Stack Web Dev Workshop','Workshop','2026-11-22','10:00 AM – 4:00 PM','Lab Complex – Block B',
   'Hands-on session covering React, Node.js, and deployment. Build a mini project by end of day. Laptops required.',40,28,'All branches · Year 2+'),
  ('evt-002','AI & Machine Learning Seminar','Seminar','2026-11-25','2:00 PM – 5:00 PM','Auditorium Hall A',
   'Industry experts discuss real-world AI applications, career paths, and the latest research trends in generative AI.',150,112,'Open to all'),
  ('evt-003','TechnoVista 2026 – Annual Tech Fest','Fest','2026-12-05','9:00 AM onwards','Main Campus Grounds',
   'Three-day tech festival with coding contests, robotics, startups expo, pro nights and food stalls. Multiple events to participate.',500,387,'College ID mandatory'),
  ('evt-004','Hackathon: Code for Change','Competition','2026-11-29','9:00 AM – 9:00 PM','Innovation Hub',
   '24-hour hackathon focused on social impact solutions. Teams of 2–4. Prizes worth ₹1 Lakh. Mentors available on-site.',80,76,'Teams of 2–4 · Any year'),
  ('evt-005','UI/UX Design Masterclass','Workshop','2026-12-02','11:00 AM – 3:00 PM','Design Studio – Floor 3',
   'Learn Figma, design systems, and user research methods. Create a complete mobile app prototype in one session.',30,12,'Design / CS / IT preferred'),
  ('evt-006','Entrepreneurship & Startup Pitch','Seminar','2026-12-08','3:30 PM – 6:00 PM','Seminar Hall C',
   'Founders share journeys, funding tips, and pitch feedback. Live Q&A and networking with local incubators.',100,45,'Open to all'),
  ('evt-007','Robotics Challenge Finals','Competition','2026-12-12','10:00 AM – 6:00 PM','Sports Complex Arena',
   'Final round of inter-college robotics competition. Spectators welcome. Live scoring and commentary.',200,200,'Registered teams only (spectators free)'),
  ('evt-008','Cultural Night – Rhythm & Beats','Fest','2026-12-15','6:00 PM – 10:00 PM','Open Air Theatre',
   'Music, dance, drama and fashion show. Student performances and guest artists. Free entry with registration.',400,210,'College students only')
on conflict (id) do update set
  title = excluded.title, category = excluded.category, event_date = excluded.event_date,
  time_label = excluded.time_label, venue = excluded.venue, description = excluded.description,
  seats = excluded.seats, eligibility = excluded.eligibility;
-- (initial_registered is intentionally NOT overwritten on re-run)
