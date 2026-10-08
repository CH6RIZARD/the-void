# curator.mjs — clip labeling for the reels wall

The proxy's `/reels` ranks video by raw engagement, which cannot tell a bodycam
clip from a cat. `scripts/curator.mjs` looks at each clip once with a local LLM
and writes what it is, so the wall can be a news feed instead of a firehose.

```
node scripts/curator.mjs              # loop, every 5 min (CURATOR_EVERY_MS)
node scripts/curator.mjs --once       # one pass
node scripts/curator.mjs --once --dry # label, write nothing, print 3 samples
```

Each pass: scout (proxy `/reels`, two Bluesky video feed generators, 48h top
search for footage/police/protest/breaking) -> key by video cid/url, skip what
the store already holds -> label new clips 5 at a time via Ollama
(`qwen2.5:3b`, JSON, temperature 0), at most 6 batches per pass -> write.

Outputs (atomic tmp+rename, 72h window):

- `scripts/curated.json` — `{generated, items:{key:{key,platform,text,caption,video,thumb,url,createdAt,likes,reposts,graphic,genre,topic,fit,labeledAt}}}`. A clip the model could not label twice is kept as `{error:true}` so it is not retried every pass.
- `scripts/curated.public.json` — `{generated, items:[...]}`, the top 60 by `fit*0.6 + log10(1+likes)*0.1 + freshness`, for the proxy to serve. `graphic` is source flag OR model flag.

Env: `OLLAMA_URL` (default `http://127.0.0.1:11434`), `CURATOR_MODEL`,
`PROXY_BASE`, `CURATOR_EVERY_MS`.

Ollama down or crashing mid-pass: logged, scouting still runs, unlabeled clips
wait for the next pass. Measured 2026-10-08 on this CPU: one warm 5-clip batch
took ~170 s, not tens of seconds, so a full 6-batch pass can exceed the 5-min
interval; the loop simply starts the next pass when the current one ends.
