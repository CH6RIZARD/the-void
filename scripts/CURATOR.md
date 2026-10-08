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
`PROXY_BASE`, `CURATOR_EVERY_MS`, `OLLAMA_EXE` (default `E:\Ollama\ollama.exe`),
`OLLAMA_MODELS` (default `E:\ollama-models`).

The Ollama server runs in its own scheduled task, `VoidOllama` (at logon, runs
`E:\Ollama\serve.cmd`, which sets `OLLAMA_MODELS` and starts `ollama serve`).
Nothing else keeps it up: the tray app is stopped on purpose (it re-warms the
model into RAM and starves release builds), and a server spawned from the
curator died with the pass. A pass that finds the server down fires the task
and waits up to 30 s. The install on E: is the one to run; the original on D:
is on a drive that went write-protected and was unreachable from 14:01 to
17:00 on 2026-10-08. `OLLAMA_TASK` overrides the task name.

A batch answer missing some indices keeps the labels it did return; the
missing clips are not stored and come back as new on the next pass. (The old
all-or-nothing parse failed 4 of 6 batches on this CPU: 20 errors, 5 labels.)

Ollama down or crashing mid-pass: logged, scouting still runs, unlabeled clips
wait for the next pass. Measured 2026-10-08 on this CPU: one warm 5-clip batch
took ~170 s, not tens of seconds, so a full 6-batch pass can exceed the 5-min
interval; the loop simply starts the next pass when the current one ends.
