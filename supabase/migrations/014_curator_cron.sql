-- 014: the curator (clip labels + slop scores) on Supabase's scheduler instead of a PC.
--
-- pg_cron fires every 5 minutes; pg_net POSTs the proxy's /curator/run, which runs one
-- pass on Railway with the model at LLM_URL (see scripts/curator.mjs). The proxy key is
-- read from Vault, so it is never in this file. Before running this, store it once:
--
--   select vault.create_secret('<the CURATOR_KEY set on Railway>', 'curator_key');
--
-- To pause:   select cron.unschedule('void-curator');
-- To check:   select * from cron.job_run_details order by start_time desc limit 5;
--             select status_code, content from net._http_response order by created desc limit 5;

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobid) from cron.job where jobname = 'void-curator';
select cron.schedule(
  'void-curator',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://void-proxy-production.up.railway.app/curator/run',
    headers := jsonb_build_object(
      'content-type', 'application/json',
      'x-curator-key', (select decrypted_secret from vault.decrypted_secrets where name = 'curator_key')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  );
  $$
);
