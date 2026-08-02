-- ============================================================
-- 002_contention_split.sql
--
-- Separates the two DIFFERENT quantities that were about to be conflated into
-- one `contention_score` column.
--
-- WHAT 001 ACTUALLY SHIPPED
-- 001 declares `contention_score real` as a PLAIN nullable column — no generated
-- expression, and no vote columns at all. So the `power(x, 0) = 1` failure is not
-- yet live: the expression that would produce it does not exist. This migration
-- adds the vote storage AND the expression together, with the guard built in from
-- the start, so that failure never gets a chance to ship.
--
-- THE FAILURE BEING PREVENTED
-- The natural expression is
--     power(up + down, least(up,down) / greatest(greatest(up,down),1))
-- For any source with no downvote channel (Bluesky, Mastodon, Hacker News,
-- GDELT), down_count is always 0, so the exponent is 0, and power(x, 0) = 1 for
-- every x. Every row from those sources would score exactly 1.0 — a constant
-- column. That is the same zero-discrimination defect as a hardcoded tag, moved
-- into the ranking signal where it is harder to see.
--
-- THE RULE
-- `contention_score`  is only defined where a true negative signal exists.
--                     NULL elsewhere — honestly unmeasurable, not faked.
-- `contention_proxy`  is reply/quote-derived pressure. A DIFFERENT UNIT.
--
-- Never COALESCE them into one sort key. Sort on contention_score where it is
-- non-null, contention_proxy otherwise. Blending silently ranks a Lemmy vote
-- ratio against a Bluesky quote ratio on a scale neither of them shares.
-- ============================================================

-- ---------- true-negative vote storage ----------

-- Set true ONLY by providers whose upstream reports an explicit negative
-- (Lemmy upvotes/downvotes, PeerTube likes/dislikes). Never inferred.
alter table topics add column has_true_negative boolean not null default false;

alter table topics add column up_count   integer not null default 0;
alter table topics add column down_count integer not null default 0;

-- ---------- reply/quote-derived pressure (separate unit) ----------

alter table topics add column reply_count    integer not null default 0;
alter table topics add column quote_count    integer not null default 0;
-- likes + reposts/boosts: the "agreement" denominator.
alter table topics add column positive_count integer not null default 0;

-- ---------- contention_score: replace the plain column with a guarded expression ----------

-- 001's version is a plain column; there is nothing to preserve since no ingest
-- path writes it yet.
alter table topics drop column contention_score;

alter table topics add column contention_score real
  generated always as (
    case
      -- The guard. No negative channel => the quantity is undefined here, and
      -- NULL says so. Returning a number would be a lie with a constant value.
      when not has_true_negative then null
      when up_count + down_count = 0 then 0
      else power(
             (up_count + down_count)::real,
             least(up_count, down_count)::real
               / greatest(greatest(up_count, down_count), 1)::real
           )
    end
  ) stored;

-- ---------- contention_proxy ----------

-- People quote to argue and like to agree, so a quote is weighted 2x a reply.
-- +1 on the denominator keeps a zero-positive item from dividing by zero and
-- from scoring infinitely contested on one reply.
alter table topics add column contention_proxy real
  generated always as (
    case
      when positive_count + reply_count + quote_count = 0 then 0
      else (reply_count + 2 * quote_count)::real / (positive_count + 1)::real
    end
  ) stored;

-- ---------- indexes ----------

create index topics_contention_proxy_idx
  on topics (region_code, contention_proxy desc);

-- The non-null branch of the sort. Partial, because rows without a true negative
-- are never read through this path.
create index topics_contention_score_idx
  on topics (region_code, contention_score desc)
  where has_true_negative;

-- ---------- invariant ----------

-- A row claiming a true negative must actually carry votes. Without this a
-- provider bug could set the flag with 0/0 and silently reintroduce a constant
-- (contention_score would be 0 for every such row).
alter table topics add constraint topics_true_negative_has_votes
  check (not has_true_negative or (up_count + down_count) > 0);

comment on column topics.contention_score is
  'Vote-balance contention. NULL where the source has no true negative — do not coalesce with contention_proxy; different units.';
comment on column topics.contention_proxy is
  'Reply/quote-derived contention pressure. Used only where contention_score is NULL.';
comment on column topics.has_true_negative is
  'True only for sources reporting an explicit negative (Lemmy, PeerTube). Never inferred.';
