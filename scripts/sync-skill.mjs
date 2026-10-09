// Copies ../skill/crawlwise into cli/skills/crawlwise so `crawlwise skills install`
// ships the same skill the repo maintains. Runs on prepack; a no-op outside the monorepo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cli = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.resolve(cli, '..', 'skill', 'crawlwise');
const dest = path.join(cli, 'skills', 'crawlwise');
if (!fs.existsSync(path.join(src, 'SKILL.md'))) {
  console.log('sync-skill: no ../skill/crawlwise here, keeping the bundled copy');
} else {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
  console.log('sync-skill: copied', src, '->', dest);
}
