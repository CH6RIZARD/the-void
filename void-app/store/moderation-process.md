# Moderation process (minimum for Apple 1.2 and Google Play UGC)

This is the smallest process that meets the "timely response" part of the rules. It uses the tables and functions in `supabase/migrations/006_moderation.sql`. There is no moderator dashboard yet: moderators work in the Supabase dashboard (SQL editor, which runs as service_role).

## What users can do in the app

| Action | Where | What it does |
|---|---|---|
| Report a post or reply | `...` on feed posts, nation feed posts, thread OP, thread replies, reels info row | Adds a row to `reports` (reason plus an optional note). The post is hidden for the reporter at once. Without a session, the report is queued on the device and sent after sign-in. |
| Report an account | Tap the author's name or avatar in a thread or on a reel, then REPORT ACCOUNT | Adds a `reports` row with `target_user_id`, or with `target_external` for an account on another platform. |
| Block a Void user | `...` then Block, or the author sheet | Adds a `blocks` row. RLS hides their posts, replies, media and notifications from the blocker. DMs are refused in both directions. The client hides them right away. |
| Hide a third-party author or source | `...` then Hide | Stored on the device only (`void_blocks`, keyed by handle or host). A report still reaches us when the user is signed in. |
| Mute a keyword | `...` then Mute a keyword, or Settings > Blocked accounts | Stored on the device (`void_muted`). |
| Filter graphic media | Settings > Content > Hide graphic content (on by default) | Blurs media tagged `graphic` until the user taps it. |
| Accept terms | A sheet before the first post, reply or DM | Sets `profiles.terms_accepted_at`. `posts_insert` RLS rejects posts from accounts that have not accepted. |
| Contact us | Settings > Safety > Contact & support | Shows `SUPPORT_EMAIL` (**TODO: set the real inbox** in `void2-final.html`) plus links to the terms and privacy policy. |

Automatic: a post reported by 3 or more distinct users gets `posts.hidden_at` set. It disappears for everyone except its author until a moderator reviews it.

## Service level

- Every open report is reviewed **within 24 hours**. Say this in the App Review notes and in the terms.
- Auto-hidden posts (`hidden_at is not null`) and reasons `violence`, `sexual` and `hate` go first.
- Sexual content involving minors: remove it right away, ban the account, keep the evidence, and report it to NCMEC (US) or the relevant national authority. Do not wait for the queue.

## Daily routine (at least once every 24h, preferably twice)

1. Open the queue:
   ```sql
   select * from moderation_queue;              -- open reports, oldest first
   select id, body, author_id, hidden_at from posts where hidden_at is not null;
   ```
2. For each reported post, decide:
   ```sql
   select moderate_post('<post uuid>', 'remove', '<your name>', 'harassment');   -- deletes the post and closes its reports
   select moderate_post('<post uuid>', 'keep',   '<your name>', 'no violation'); -- unhides it and dismisses its reports
   ```
3. For account reports, or when removing a post that clearly breaks the zero-tolerance rule, ban the author:
   - Supabase dashboard > Authentication > Users > the user > **Ban user** (or delete the user; `on delete cascade` removes their profile, posts and blocks).
   - Close the account's reports:
     ```sql
     update reports set status='actioned', reviewed_at=now(), reviewed_by='<you>', resolution='account banned'
      where status='open' and (target_user_id='<uuid>' or target_post_id in (select id from posts where author_id='<uuid>'));
     ```
4. Reports about third-party content (`target_external` such as `bluesky:handle`, `host:example.com`): remove that account or domain from the aggregation sources (the feed lists in `void2-final.html` or the proxy's source list), then close the report with `status='actioned'`. When the content breaks that platform's rules, report it there too.
5. Reply by email to any report or appeal that came in through `SUPPORT_EMAIL`.

## Records

- Reports are never deleted. `status`, `reviewed_at`, `reviewed_by` and `resolution` form the audit trail.
- Keep a short log of bans (date, account, reason) for appeals and for store reviewers who ask.

## Known gaps / next steps

- **No moderator dashboard.** The SQL above is the tool. A small admin page (service-role Edge Function plus a password-protected page) would replace it.
- **No push alert** when the queue grows or a post is auto-hidden. Add a database webhook on `reports` insert to email or Slack the on-call moderator. This matters for keeping the 24h promise.
- **No server-side word filter** on `posts` insert yet (ios-readiness §2.3 item 2). Only the client keyword mute and the graphic blur exist.
- Blocks of third-party authors and sources, and the keyword mutes, stay on the device. They are not synced between devices.
- The demo DM screen (`VOID_USERS`) is local. Its block guard is client-side. The real DM path is enforced by RLS (`messages_read`, `messages_write`, `start_dm`).
- The privacy URL used in the app is `https://void-app-d35c.pages.dev/privacy`. Make sure that page is published next to `terms.html`.
