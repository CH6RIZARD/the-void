# delete-account

Server side of in-app account deletion (Apple App Review 5.1.1(v), Google Play
account deletion policy). Called by the "Delete account" row in Settings of
`void2-final.html` and by `account-deletion.html` (the public web deletion URL).

Nothing here has been deployed. Do these steps once, in order.

## 1. Apply the SQL

`supabase/migrations/005_account_deletion.sql` creates:

- `delete_user_data(p_user uuid)`: service_role only. Deletes everything the user owns.
- `delete_my_account()`: authenticated users, anonymous ones included. It is the RPC fallback the app uses when this function is not deployed.
- `account_deletion_requests`: a queue for logins whose data is gone but whose `auth.users` row could not be deleted from SQL.

It depends on 004 being applied first, because it references `taste_profiles` when that table exists.

```sh
# linked CLI
supabase db push
# or paste the file into Dashboard -> SQL Editor -> Run
```

## 2. Deploy the function

```sh
supabase login
supabase link --project-ref zsrpsdufwgfyfoulmazt
supabase functions deploy delete-account --project-ref zsrpsdufwgfyfoulmazt
```

The function verifies the token itself with `auth.getUser`, so it also works with
`--no-verify-jwt`. Use that flag if the project uses the new asymmetric JWT
signing keys and the gateway rejects tokens. Otherwise keep the default.

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are injected
automatically. Never put the service role key in the app.

## 3. Optional secrets

```sh
# Restrict CORS (default "*": safe, the endpoint is bearer-token only, no cookies).
# Include "null" for file:// pages and the bundled app WebView fallback.
supabase secrets set ALLOWED_ORIGINS="https://void-app-d35c.pages.dev,null"

# Sign in with Apple token revoke (Apple requires it on account deletion).
supabase secrets set APPLE_TEAM_ID=XXXXXXXXXX APPLE_KEY_ID=XXXXXXXXXX \
  APPLE_CLIENT_ID=com.thevoid.app \
  APPLE_PRIVATE_KEY="$(cat AuthKey_XXXXXXXXXX.p8)"
```

Apple revoke needs all four `APPLE_*` values. The key is a "Sign in with Apple"
key from developer.apple.com. `APPLE_CLIENT_ID` is the bundle id for native
sign-in, or the Services ID for web sign-in. Apple also needs a token to revoke.
Supabase does not store Apple's refresh token, so the client sends
`apple_refresh_token` (the session's `provider_refresh_token`, only present right
after an Apple sign-in) when it has one. If the vars or the token are missing,
the function skips the revoke and says so in `apple.reason`. The account is still
deleted. For the native build, keep the refresh token from the
`expo-apple-authentication` code exchange and send it.

## 4. Smoke test

```sh
# Make a throwaway anonymous user (anonymous sign-ins must be enabled)
TOKEN=$(curl -s "$URL/auth/v1/signup" -H "apikey: $ANON" -H 'content-type: application/json' \
  -d '{"data":{"anonymous":true}}' | jq -r .access_token)

curl -s -X POST "$URL/functions/v1/delete-account" \
  -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{}'
# -> {"ok":true,"auth_user_deleted":true,...}

# The token is dead now:
curl -s "$URL/auth/v1/user" -H "apikey: $ANON" -H "Authorization: Bearer $TOKEN"   # 4xx
```

Rejections to check: no bearer gives 401 `missing_bearer_token`. Sending the anon
key as the bearer gives 401 `invalid_session`.

## Responses

| status | body | meaning |
|---|---|---|
| 200 | `ok:true, deleted:{table:count}, storage, apple` | everything gone |
| 401 | `missing_bearer_token` / `invalid_session` | nothing deleted |
| 500 | `data_cleanup_failed` | SQL not applied or failed; nothing deleted (the login is kept on purpose) |
| 500 | `auth_delete_failed, data_deleted:true` | data gone, login queued in `account_deletion_requests` |

## Queue

When the RPC fallback ran and `postgres` could not delete from `auth.users`,
the data is gone but the login row is left. Process the queue from a trusted
shell:

```sh
# for each user_id in: select user_id from account_deletion_requests where completed_at is null;
curl -X DELETE "$URL/auth/v1/admin/users/<user_id>" \
  -H "apikey: $SERVICE_ROLE" -H "Authorization: Bearer $SERVICE_ROLE"
# then: update account_deletion_requests set completed_at = now() where user_id = '<user_id>';
```

Once this function is deployed, the app always uses it, so the queue only fills
from the fallback path.

## What is deleted

See the header of `005_account_deletion.sql`: profiles, posts (plus replies
others wrote under them, via the `reply_to` cascade in 001), post_media,
reactions (own, and those on own posts, with rank scores corrected), follows in
both directions, notifications to and from the user, devices, prekeys,
envelopes, messages, DM conversations and memberships, taste_profiles, any later
user-owned table (reports, blocks, media, ...) found by the column sweep,
storage objects owned by the user or under `<user id>/`, and the auth user.
