// The tile-sized variant picker: master playlists in, one URL out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMaster, pickVariant } from '../hlsVariant.ts';

const MASTER = `#EXTM3U
#EXT-X-STREAM-INF:BANDWIDTH=300000,RESOLUTION=426x240,CODECS="avc1.42c00d,mp4a.40.2"
240/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=900000,RESOLUTION=854x480
480/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2500000,RESOLUTION=1280x720
/abs/720/index.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=64000,CODECS="mp4a.40.2"
audio/index.m3u8
`;

test('parseMaster: variants with RESOLUTION only, URLs made absolute', () => {
  const v = parseMaster(MASTER, 'https://cdn.example.com/live/master.m3u8?t=1');
  assert.equal(v.length, 3); // the audio-only rendition is skipped
  assert.deepEqual(
    v.map((x) => [x.width, x.height, x.bandwidth]),
    [
      [426, 240, 300000],
      [854, 480, 900000],
      [1280, 720, 2500000],
    ],
  );
  assert.equal(v[0].url, 'https://cdn.example.com/live/240/index.m3u8');
  assert.equal(v[2].url, 'https://cdn.example.com/abs/720/index.m3u8');
});

test('parseMaster: a media playlist is not a master', () => {
  const media = '#EXTM3U\n#EXT-X-TARGETDURATION:6\n#EXTINF:6.0,\nseg1.ts\n';
  assert.deepEqual(parseMaster(media, 'https://x/y.m3u8'), []);
});

test('pickVariant: smallest that still covers the tile', () => {
  const v = parseMaster(MASTER, 'https://cdn.example.com/live/master.m3u8');
  // A 350px wall tile: 480p covers it, 720p is wasted memory.
  assert.equal(pickVariant(v, 350)?.width, 854);
  // A full-width hero still gets the big one.
  assert.equal(pickVariant(v, 1080)?.width, 1280);
  // Never below the readable floor, even for a tiny tile.
  assert.equal(pickVariant(v, 120)?.width, 854);
});

test('pickVariant: nothing big enough falls back to the largest', () => {
  const v = parseMaster('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100000,RESOLUTION=320x180\na.m3u8\n', 'https://x/m.m3u8');
  assert.equal(pickVariant(v, 1200)?.width, 320);
  assert.equal(pickVariant([], 350), null);
});
