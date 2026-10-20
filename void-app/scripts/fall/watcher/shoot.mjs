// Renders each Y2K tile in y2k.html to out/<id>.png (1024 px). node shoot.mjs
import puppeteer from 'puppeteer';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
fs.mkdirSync(path.join(here, 'out'), { recursive: true });
const b = await puppeteer.launch({ headless: true, executablePath: process.env.CHROME || undefined });
const p = await b.newPage();
await p.setViewport({ width: 1024, height: 1024 });
await p.goto(pathToFileURL(path.join(here, 'y2k.html')).href);
for (const id of await p.$$eval('svg.tile', (s) => s.map((e) => e.id))) {
  await (await p.$('#' + id)).screenshot({ path: path.join(here, 'out', id + '.png') });
  console.log(id);
}
await b.close();
