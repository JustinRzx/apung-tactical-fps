import { cpSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-threejs.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const game = join(here, 'game');
const shots = join(here, 'screenshots');
if (!existsSync(join(game, 'index.html'))) throw new Error('game/index.html is missing');
const shotFiles = existsSync(shots) ? readdirSync(shots).filter((name) => /\.(png|jpe?g)$/i.test(name)) : [];
if (shotFiles.length < 3 || shotFiles.length > 4) throw new Error('screenshots must contain 3 or 4 images');
for (const name of shotFiles) if (statSync(join(shots, name)).size > 262144) throw new Error(`screenshot exceeds 256 KiB: ${name}`);
mkdirSync(out, { recursive: true });
cpSync(game, join(out, 'game'), { recursive: true });
cpSync(shots, join(out, 'screenshots'), { recursive: true });
writeFileSync(join(out, 'dossier.json'), buildDossier(out, { text_max_bytes: 163840, screenshots: { max: 4, max_bytes: 262144 }, game_max_files: 993, game_max_bytes: 50331648 }));
