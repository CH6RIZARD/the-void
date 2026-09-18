# `001_void_schema.sql` — review before first run

> **Rev 2 reviewed — see `## REV 2` at the bottom.** All six blockers below are
> resolved. Rev 2's recursion note is correct and supersedes my fix for BLOCKER 1:
> a policy on `conversation_members` that references `conversation_members`
> recurses regardless of qualification, so the `security definer` helper is
> required, not optional. Two new issues were introduced by the fixes, and six
> lower-severity findings from this review remain unaddressed.

Read-verified against Postgres/RLS semantics. **Not** executed — there is no
Postgres in this environment, so nothing below is run-verified. Anything marked
BLOCKER should be fixed before the migration is applied, because each one is
either a data leak or a flow that cannot work at all.

---

## BLOCKER 1 — `conv_members_read` is a tautology; it leaks the whole DM graph

```sql
create policy conv_members_read on conversation_members for select
  using (exists (select 1 from conversation_members m
                 where m.conversation_id = conversation_id and m.user_id = auth.uid()));
```

`conversation_id` is unqualified, and the subquery's own `FROM` shadows the outer
table. Postgres resolves it to `m.conversation_id`, so the predicate is
`m.conversation_id = m.conversation_id` — always true.

Effect: **any user who belongs to at least one conversation can select every row in
`conversation_members`** — the complete who-talks-to-whom graph for every user on
the platform. In a product whose DM pitch is privacy, that is the single worst
metadata to leak, and it leaks to any authenticated account.

`conv_read` and `messages_read` are written correctly (`m.conversation_id = id`
resolves outward because `conversation_members` has no `id` column;
`messages.conversation_id` is explicitly qualified). This one policy is the bug.

```sql
create policy conv_members_read on conversation_members for select
  using (exists (select 1 from conversation_members m
                 where m.conversation_id = conversation_members.conversation_id
                   and m.user_id = auth.uid()));
```

Rule to apply everywhere: **always qualify the outer table by name inside RLS
subqueries.** This class of bug is silent — it fails open, and no test that checks
"can a member read their own conversation?" will catch it.

---

## BLOCKER 2 — `claim_prekey_bundle` has the exact race the brief forbids

The brief says a one-time prekey handed out twice breaks forward secrecy and "must
never be a client-side select-then-update." Correct — but moving it server-side did
not remove the race, it relocated it:

```sql
update one_time_prekeys o
   set claimed_at = now()
 where o.ctid in (
   select distinct on (p.device_id) p.ctid
   from one_time_prekeys p ... where p.claimed_at is null
   order by p.device_id, p.key_id)
```

Under READ COMMITTED, two concurrent calls for the same user both evaluate the
subquery against the same snapshot and select the same `ctid`. The second blocks on
the row lock, and recovery depends on EvalPlanQual re-checking a `ctid IN
(subplan)` qual — which is not a guarantee you want forward secrecy resting on.
Two sessions can be issued the same one-time prekey.

The idiom that is actually safe is an explicit lock with `SKIP LOCKED`:

```sql
with dev as (
  select d.id, d.registration_id, d.identity_key
  from devices d where d.user_id = target_user
),
picked as (
  select p.device_id, p.key_id, p.public_key
  from one_time_prekeys p
  join dev on dev.id = p.device_id
  where p.claimed_at is null
  order by p.device_id, p.key_id
  for update of p skip locked          -- concurrent callers take different rows
),
otpk as (
  update one_time_prekeys o set claimed_at = now()
  from picked
  where o.device_id = picked.device_id and o.key_id = picked.key_id
  returning o.device_id, o.key_id, o.public_key
)
...
```

Note `for update ... skip locked` cannot be combined with `distinct on` in one
scan; take the lock first, then dedupe per device in the outer select.

Related, same function: any authenticated user may call it for any `target_user`,
with no rate limit. That is correct for X3DH — you must fetch a stranger's bundle
to open a session — but it also means an attacker can **drain a victim's one-time
prekeys** in a loop, forcing every subsequent session onto the signed prekey and
losing that session's forward secrecy. Signal rate-limits this. Add a per-caller
limit and monitor `count(*) where claimed_at is null` per device.

---

## BLOCKER 3 — a conversation can never be created

`conversations` and `conversation_members` have RLS enabled and **only `SELECT`
policies**. RLS is default-deny, so there is no path for a client to insert either
row. The messaging feature cannot bootstrap: no conversation, therefore no members,
therefore no messages.

Do not fix this with an open insert policy — "who may add whom to a conversation"
is not expressible safely in a `WITH CHECK` (the first member has no existing row
to check against, so any policy permissive enough to create a DM is permissive
enough to insert yourself into someone else's). Use a `security definer` RPC:

```sql
create or replace function start_dm(target_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if target_user = auth.uid() then raise exception 'cannot dm self'; end if;

  select cm.conversation_id into cid                    -- reuse existing DM
  from conversation_members cm
  join conversation_members other on other.conversation_id = cm.conversation_id
  join conversations c on c.id = cm.conversation_id
  where cm.user_id = auth.uid() and other.user_id = target_user and c.kind = 'dm'
  limit 1;
  if cid is not null then return cid; end if;

  insert into conversations (kind) values ('dm') returning id into cid;
  insert into conversation_members (conversation_id, user_id)
  values (cid, auth.uid()), (cid, target_user);
  return cid;
end; $$;
```

The dedupe matters: without it, tapping a user twice from search creates two
parallel DM threads with the same person and splits the history.

---

## BLOCKER 4 — delivery and read state can never be written

`message_envelopes` has `delivered_at` and an index
`where delivered_at is null`, but **no `UPDATE` policy** — a device can never mark
its own envelope delivered, so the undelivered queue grows forever and never
drains. Same for `conversation_members.last_read_at`: select-only, so unread counts
and read receipts cannot work.

```sql
create policy envelopes_ack on message_envelopes for update
  using (exists (select 1 from devices d
                 where d.id = message_envelopes.recipient_device_id
                   and d.user_id = auth.uid()))
  with check (exists (select 1 from devices d
                      where d.id = message_envelopes.recipient_device_id
                        and d.user_id = auth.uid()));

create policy conv_members_touch on conversation_members for update
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

---

## BLOCKER 5 — `region_code` is client-settable, contrary to its own comment

The column is commented `DERIVED, never client-supplied`, but two things together
make it writable:

- the trigger is `before insert or update **of location**`, so an `UPDATE` that
  touches only `region_code` does not fire it;
- `posts_write` is `for all` with no column restriction.

So an author can `update posts set region_code = 'US-TX'` on a post whose
`location` is in Lagos, and it sticks. Every region-scoped read
(`posts_region_idx`, `region_view`) then serves misplaced content, and the drift is
invisible because `location` still looks right.

```sql
create trigger posts_set_region
  before insert or update on posts        -- not: update of location
  for each row execute function set_post_region();
```

Firing on every update is cheap here (the function short-circuits when `location`
is null and otherwise does one indexed `ST_Covers`) and makes the column
genuinely derived: whatever the client sends is overwritten.

---

## BLOCKER 6 — an author can set their own `rank_score`

`posts_write` is `for all` on every column, so `update posts set rank_score =
999999 where id = <own post>` succeeds. `rank_score` drives
`posts_rank_idx`, `posts_in_bbox` ordering and `region_view` — i.e. the entire
feed ranking is author-controlled.

Cheapest robust fix is a guard trigger, since RLS has no column granularity:

```sql
create or replace function lock_derived_post_cols()
returns trigger language plpgsql as $$
begin
  new.rank_score := old.rank_score;   -- only apply_reaction_score may move this
  return new;
end; $$;

create trigger posts_lock_derived
  before update on posts
  for each row execute function lock_derived_post_cols();
```

`apply_reaction_score` updates `rank_score` from a `security definer` function, so
give it a bypass (e.g. a session flag it sets, or move the counter to a separate
`post_scores` table the client has no write policy on — cleaner, and it stops
reaction writes from bloating the `posts` row).

> **Status (004_ranking_security.sql):** UPDATE was closed in 001 by column
> grants. INSERT stayed open (`posts_insert` checked only `author_id`), so a post
> could be created with any `rank_score`. 004 adds a `posts_guard_insert` trigger
> (forces `rank_score = 0`, clears `region_code` before `posts_set_region`
> re-derives it) and restricts INSERT to `(id, author_id, body, location,
> reply_to)`. It also blocks moving a reaction to another post
> (`reactions_lock_keys`): `apply_reaction_score` credited the delta only to the
> new post, so insert/move/re-insert pumped the original without bound.

---

## HIGH — `topics.source` omits `gdelt`

```sql
source text not null check (source in ('x','reddit','manual'))
```

This constraint rejects the source the brief's own ingestion section recommends
leading with, and hardcodes the one it warns against. X is now pay-per-use at
**$0.005/post read** for new developers (Basic/Pro closed to new signups,
Enterprise ≈$42k/mo) — and `topics` is the *common* case across most of the map,
so it is the highest-volume read path in the system. GDELT is free, natively
region-keyed via `sourcecountry:`, already on the `CONTRACTS.md` allowlist, and
already verified working in `void2-final.html`.

```sql
source text not null check (source in ('gdelt','reddit','x','manual'))
```

Also: `topics` carries no `CONTRACTS.md` provenance columns (`source_host`,
`fetched_at` exists, but no `response_hash` / `raw_response_url`). Every other
ingested item is required to carry them; this table should not be an exception.

---

## HIGH — `envelopes_write` binds neither recipient nor sender

```sql
with check (exists (select 1 from messages msg
                    join conversation_members m on m.conversation_id = msg.conversation_id
                    where msg.id = message_id and m.user_id = auth.uid()))
```

It checks only that the caller is a member of the conversation. It does not check
that `recipient_device_id` belongs to a member of that conversation, nor that
`msg.sender_id = auth.uid()`. So any member can attach arbitrary ciphertext to
*another member's* `message_id`, addressed to *any device on the platform*.

The forged ciphertext will not decrypt under the real sender's ratchet, so this
fails safe cryptographically — but it is a spam/DoS channel into strangers'
undelivered queues and a source of "unable to decrypt" noise attributed to an
innocent sender. Add both checks.

---

## HIGH — `devices_read` is a presence oracle

```sql
create policy devices_read on devices for select using (auth.role() = 'authenticated');
```

Any authenticated account can read every device row for every user, including
`display_name` and `last_seen_at`. That is a per-user activity feed — when someone
was last online, how many devices they own, what they named them — available to
anyone who signs up.

Session setup only needs the keys for a *specific* target, and that is exactly what
`claim_prekey_bundle` already returns. Drop the blanket policy and let the RPC be
the only read path; if a direct policy is kept, it should not expose `last_seen_at`.

---

## MEDIUM

**`posts_in_bbox` breaks across the antimeridian.** `ST_MakeEnvelope(min_lng, …,
max_lng, …)` with `min_lng > max_lng` (a viewport spanning the Pacific) produces an
empty or inverted box, so panning the globe across ±180° silently returns nothing.
Split into two envelopes and union when `min_lng > max_lng`.

**`notifications.type` allows `'reply'` and `'message'`, but no trigger emits
either.** `posts.reply_to` inserts generate no notification, so thread replies are
silent — and the notification feed is a stated requirement. `'message'` should
stay unemitted by the server: a notification row naming a conversation is fine,
but nothing server-side may inspect content, so the body must be filled client-side
after local decryption.

**`handle` is `citext` with `check (handle ~ '^[a-z0-9_]{3,20}$')`.** Uniqueness is
case-insensitive but the check rejects uppercase outright, so `Bob` is a constraint
violation rather than being folded to `bob`. Lowercase on write (or use
`~* '^[a-z0-9_]{3,20}$'`) so signup doesn't fail on a capital letter.

**`regions`, `places`, `topics` have read policies but no write policies** — so
seeding and the cron functions must run as service role. That is correct and worth
stating explicitly in the runbook, since it is otherwise discovered at 2am.

---

## Note on `posts.location`

I previously argued for dropping this column; the brief reinstates it with the
geo-anchor comment and the `ST_Covers` derivation, which is a reasonable call — the
globe needs a point to place a pin and to derive the region. Recording the residual
risk only: with the column present, nothing structurally prevents a future client
from writing a device coordinate into it. That is now enforced by convention and
code review rather than by the schema. Worth a lint rule on the client that the
value passed to `location` never originates from a geolocation API.

---
---

# REV 2

All six blockers resolved. `dm_key` as a structural dedupe is better than the
check-then-insert I proposed — it moves the race into a unique constraint instead
of relying on the function getting it right. Column-level `grant`/`revoke` to
enforce derived columns is the correct answer to "RLS has no column granularity."

Two new issues, both consequences of the fixes.

## NEW BLOCKER A — the prekey lock has no per-device limit; concurrent callers silently lose forward secrecy

```sql
locked as (
  select o.device_id, o.key_id
  from one_time_prekeys o
  where o.claimed_at is null
    and o.device_id in (select dev.id from dev)
  order by o.device_id, o.key_id
  for update skip locked        -- no LIMIT
),
```

`FOR UPDATE` locks **every row the CTE returns**, and this one returns the target
user's entire unclaimed prekey pool — not one row per device. Those locks are held
until the transaction commits. `picked` then discards all but one per device, but
the locks on the discarded rows are already taken.

So while caller A's transaction is open, caller B's `SKIP LOCKED` skips *the whole
pool* and `locked` comes back empty. `claimed` is then empty, and because the final
select uses `left join claimed`, B still receives a valid-looking bundle — just
without a one-time prekey. X3DH proceeds on the signed prekey alone, and that
session loses the forward secrecy the one-time prekey exists to provide.

It fails silently and only under concurrency, which is exactly when several people
are opening sessions with the same popular account.

Lock one row per device with a `LATERAL`, so the lock set is the size of the result
set:

```sql
locked as (
  select l.device_id, l.key_id
  from dev
  cross join lateral (
    select o.device_id, o.key_id
    from one_time_prekeys o
    where o.device_id = dev.id
      and o.claimed_at is null
    order by o.key_id
    for update skip locked
    limit 1                     -- one per device, locks exactly what it returns
  ) l
),
```

`picked` can then be dropped entirely — the `LATERAL` already yields at most one
row per device, so the `distinct on` is redundant.

Worth asserting in a test: open two concurrent transactions, call
`claim_prekey_bundle` for the same user in both, and require that they return
*different* `otpk_id`s and that neither is null.

## NEW BLOCKER B — every reaction now runs a point-in-polygon query

Fix 5a widened the trigger to `before insert or update on posts`. Correct for
security — but `apply_reaction_score()` does `update posts set rank_score = ...`,
which is an `UPDATE on posts`, so **`set_post_region` now fires on every rank and
slash**, running `ST_Covers` against `regions.geom` each time.

`regions.geom` is admin-1 MultiPolygons — thousands of rows, some with very high
vertex counts. Reactions are the highest-frequency write in the system, and every
one now pays for a spatial containment search to recompute a value that cannot have
changed, since `location` was not touched.

Short-circuit when `location` is unchanged. This keeps the column structurally
derived — a client-supplied `region_code` is still discarded, because the unchanged
branch forces it back to `old.region_code`:

```sql
create or replace function set_post_region()
returns trigger language plpgsql as $$
begin
  if tg_op = 'UPDATE' and new.location is not distinct from old.location then
    new.region_code := old.region_code;   -- discard client value, no spatial query
    return new;
  end if;

  if new.location is null then
    new.region_code := null;
    return new;
  end if;

  select r.code into new.region_code
  from regions r
  where r.geom is not null and ST_Covers(r.geom, new.location)
  order by (r.level = 'subdivision') desc
  limit 1;

  return new;
end;
$$;
```

`is not distinct from` rather than `<>` so a null-to-null transition is treated as
unchanged rather than as a difference.

Related, and now more pressing: `rank_score` lives on `posts` and is indexed by
`posts_rank_idx`. Every reaction rewrites the `posts` row and updates that index —
an indexed-column change forecloses a HOT update, so each reaction costs a heap
write plus index maintenance on the widest table in the schema. Moving the counter
to a narrow `post_scores (post_id primary key, rank_score integer)` table would
confine reaction churn to one small relation, keep `posts` rows stable, and remove
the trigger interaction in Blocker B entirely.

## Still open from the rev 1 review

Not regressions — findings that were not picked up. Listed by severity.

1. **`devices_read ... using (true)`** still exposes every device row to any
   authenticated account, including `display_name` and `last_seen_at`: a per-user
   last-seen oracle for the whole platform. `claim_prekey_bundle` already returns
   what session setup needs, so the blanket read policy has no remaining caller.
   Flagging once more only because it is metadata leakage in a product whose DM
   pitch is privacy; if it is a deliberate deferral, it belongs in the brief.

2. **`envelopes_write` still does not bind `recipient_device_id` to the
   conversation.** Rev 2 correctly added `msg.sender_id = auth.uid()`, but a sender
   may still address envelopes to *any device on the platform*. Cryptographically
   safe — the ciphertext will not decrypt — but it is an unauthenticated write into
   strangers' undelivered queues.

3. **`posts_in_bbox` still breaks across the antimeridian.** A viewport spanning
   ±180° gives `min_lng > max_lng`, and `ST_MakeEnvelope` yields an inverted box
   that matches nothing. The globe returns empty over the Pacific.

4. **No trigger emits `'reply'`.** `notifications.type` permits it and
   `posts.reply_to` exists, so thread replies are silent while the notification
   feed is a stated requirement.

5. **`handle ~ '^[a-z0-9_]{3,20}$'`** rejects uppercase outright rather than
   folding it, so `Bob` is a constraint violation at signup. Lowercase on write or
   use `~*`.

6. **`topics` carries no `CONTRACTS.md` provenance** (`response_hash`,
   `raw_response_url`). It is an ingestion path like any other and the contract
   binds it.

## Note

Read-verified only. There is still no Postgres in this environment, so none of
rev 2 has been executed — in particular the `LATERAL ... FOR UPDATE SKIP LOCKED`
rewrite above should be checked against a live instance, and the concurrency
assertion in Blocker A is the test worth writing first.
