// APUNG — Stilt-Village Tactical FPS (make.fun threejs-fps-02 entry program).
// Node 22, standard library only. Copies the playable game/ and its screenshots/ to /output and
// writes /output/dossier.json with the kit's vendored makefun library, exactly as the starter does.
//
// Locally: mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const game = join(here, 'game');
const shots = join(here, 'screenshots');

function countBytes(dir) {
  let files = 0;
  let bytes = 0;
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      const inner = countBytes(path);
      files += inner.files;
      bytes += inner.bytes;
    } else if (stats.isFile()) {
      files += 1;
      bytes += stats.size;
    }
  }
  return { files, bytes };
}

for (const required of ['index.html', 'src/main.js', 'src/palette.js', 'src/rng.js', 'src/world.js', 'src/player.js', 'src/weapon.js', 'src/bots.js', 'src/hud.js', 'src/audio.js', 'src/shots.js']) {
  if (!existsSync(join(game, required))) throw new Error(`missing game file: ${required}`);
}
if (!existsSync(shots)) throw new Error('missing screenshots/');
const shotFiles = readdirSync(shots).filter((name) => /\.jpe?g$/i.test(name)).sort();
if (shotFiles.length < 3 || shotFiles.length > 4) throw new Error(`expected 3-4 JPEG screenshots, found ${shotFiles.length}`);
for (const name of shotFiles) {
  const stats = statSync(join(shots, name));
  if (stats.size > 262144) throw new Error(`screenshot ${name} is ${stats.size} bytes, over 256 KiB`);
  const magic = readFileSync(join(shots, name)).subarray(0, 2);
  if (magic[0] !== 0xff || magic[1] !== 0xd8) throw new Error(`screenshot ${name} is not a JPEG`);
}
// EDIT-2: Update log phrasing to reflect total shots more explicitly
// Small helper to cache total shots for log clarity
const totalShots = shotFiles.length;

mkdirSync(out, { recursive: true });
cpSync(game, join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
cpSync(shots, join(out, 'screenshots'), { recursive: true });

const report = countBytes(join(out, 'game'));
if (report.files > 993) throw new Error(`game/ has ${report.files} entries, over the 993 cap`);
if (report.bytes > 50331648) throw new Error(`game/ has ${report.bytes} bytes, over the 48 MiB cap`);

const dossierPath = join(out, 'dossier.json');
writeFileSync(
  dossierPath,
  buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }),
);
const dossierSize = statSync(dossierPath).size;
// Enforce the competition's 1.5 MiB dossier limit after serialization.
if (dossierSize > 1572864) throw new Error(`dossier.json is ${dossierSize} bytes, over the 1.5 MiB cap`);
process.stdout.write(`APUNG output written to ${out} (game ${report.files} files, ${report.bytes} bytes; dossier ${dossierSize} bytes; ${totalShots} screenshots: ${shotFiles.join(', ')}; status: OK)\n`);
