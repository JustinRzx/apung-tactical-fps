// APUNG — boot, fixed-step simulation, match/round/bomb logic and the single render loop.
// Gameplay randomness is seeded per round; the renderer only reads state.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeRng, roundSeed } from './rng.js';
import { createWorld } from './world.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS, damageAt } from './weapon.js';
import { createBots } from './bots.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { stageShot } from './shots.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shotName = params.get('shot');
const isShot = !!shotName;
const isSim = params.get('sim') === '1';
const isBombTest = params.get('bombtest') === '1';
const isAutoplay = isSim || params.get('autoplay') === '1';
const simSeconds = Math.max(1, Number(params.get('t')) || 15);
const matchSeed = (Number.parseInt(params.get('seed') ?? '1', 10) || 1) >>> 0;

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.06;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 280);
scene.add(camera);

const world = createWorld(scene);
const player = createPlayer(world);
const bots = createBots(scene, world);
const weapon = createWeapon(camera);
const hud = createHud();
const visualRng = makeRng(0x9e3779b9 ^ matchSeed);
const audio = createAudio(makeRng(0x51ed270b ^ matchSeed));

let gameplayRng = makeRng(roundSeed(matchSeed, 1));

const inventory = { pistol: true, smg: false, rifle: false, sniper: false };
let currentWeapon = 'pistol';
let armourBought = false;

const ammoMap = {};
for (const id of Object.keys(WEAPONS)) ammoMap[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };

function equipWeapon(id, first = false) {
  const prev = weapon.state.id;
  if (prev) ammoMap[prev] = { mag: weapon.state.mag, reserve: weapon.state.reserve };
  if (first || !ammoMap[id]) ammoMap[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
  weapon.equip(id, false);
  weapon.state.mag = ammoMap[id].mag;
  weapon.state.reserve = ammoMap[id].reserve;
}

function refillOwned() {
  for (const id of Object.keys(inventory)) if (inventory[id]) ammoMap[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve };
}

const state = {
  phase: 'buy',
  round: 1,
  scoreTeal: 0,
  scoreAmber: 0,
  timer: 15,
  roundTime: 100,
  plan: { attackSite: 'A' },
  paused: true,
  frozen: false,
  hitstop: 0,
  trauma: 0,
  fovPunch: 0,
  elapsed: 0,
  triggerLatch: false,
  scoreboardOpen: false,
  plantProgress: 0,
  beepTimer: 0,
  footTimer: 0,
  started: false,
  bomb: { carried: true, carrier: 'player', planted: false, x: 0, z: 0, site: null, fuse: 35, defuse: 0, defuseTotal: 5, drop: 0 },
  stats: { totalKills: 0, roundsEnded: 0, lastWinner: null, plants: 0, defuses: 0, explosions: 0 },
};

let spectateBot = null;
let accumulator = 0;
let lastTime = performance.now();
const input = { keys: new Set(), lookX: 0, lookY: 0, firing: false, locked: false };
const autoCtl = { forward: false, back: false, left: false, right: false, jump: false, crouch: false, firing: false, plant: false };
const moveInput = { forward: false, back: false, left: false, right: false, jump: false, crouch: false };
let autoPath = null;
let autoGoalKey = '';

// ---------------------------------------------------------------- effects
const tracers = [];
for (let i = 0; i < 32; i += 1) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
  const mat = new THREE.LineBasicMaterial({ color: PALETTE.teal, transparent: true, opacity: 0, depthWrite: false });
  const line = new THREE.Line(geo, mat);
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);
  tracers.push({ line, life: 0, max: 0.09 });
}
let tracerIndex = 0;
function tracer(from, to, color, life = 0.09) {
  const t = tracers[tracerIndex];
  tracerIndex = (tracerIndex + 1) % tracers.length;
  const pos = t.line.geometry.attributes.position;
  pos.setXYZ(0, from.x, from.y, from.z);
  pos.setXYZ(1, to.x, to.y, to.z);
  pos.needsUpdate = true;
  t.line.material.color.set(color);
  t.line.material.opacity = 0.95;
  t.line.visible = true;
  t.life = life;
  t.max = life;
}

const bombMesh = new THREE.Group();
const bombBody = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.24, 0.32), new THREE.MeshStandardMaterial({ color: '#2b2f36', roughness: 0.7, metalness: 0.3 }));
const bombLight = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: PALETTE.amber }));
bombLight.position.set(0.1, 0.16, 0);
const bombWire = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: PALETTE.teal }));
bombWire.position.set(-0.05, 0.14, 0.1);
bombMesh.add(bombBody, bombLight, bombWire);
bombMesh.visible = false;
scene.add(bombMesh);

// ---------------------------------------------------------------- ray hit tests
const hitBox = new THREE.Box3();
const tmpOrigin = new THREE.Vector3();
const tmpDir = new THREE.Vector3();
const tmpEnd = new THREE.Vector3();
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

function boxHit(origin, dir, minX, minY, minZ, maxX, maxY, maxZ, maxT) {
  hitBox.min.set(minX, minY, minZ);
  hitBox.max.set(maxX, maxY, maxZ);
  const t = world.rayBox(origin, dir, hitBox, maxT);
  return t !== null && t >= 0 ? t : null;
}

function fireHitscan(kind, shooter, origin, dir, weaponId) {
  const def = WEAPONS[weaponId];
  const maxT = def.range * 1.6;
  const worldHit = world.raycast(origin, dir, maxT);
  let bestT = worldHit ? worldHit.t : maxT;
  let hitBot = null;
  let hitPlayer = false;
  let head = false;

  function testBot(bot) {
    let t = boxHit(origin, dir, bot.position.x - 0.19, bot.position.y + 1.46, bot.position.z - 0.19, bot.position.x + 0.19, bot.position.y + 1.84, bot.position.z + 0.19, maxT);
    if (t !== null && t < bestT) { bestT = t; hitBot = bot; hitPlayer = false; head = true; }
    t = boxHit(origin, dir, bot.position.x - 0.34, bot.position.y + 0.64, bot.position.z - 0.24, bot.position.x + 0.34, bot.position.y + 1.46, bot.position.z + 0.24, maxT);
    if (t !== null && t < bestT) { bestT = t; hitBot = bot; hitPlayer = false; head = false; }
  }

  if (kind === 'player') {
    for (const bot of bots.bots) if (bot.team === 'defenders' && bot.alive) testBot(bot);
  } else {
    for (const bot of bots.bots) if (bot.team !== shooter.team && bot.alive) testBot(bot);
    if (player.state.alive && shooter.team === 'defenders') {
      const p = player.state.position;
      let t = boxHit(origin, dir, p.x - 0.2, p.y + 1.42, p.z - 0.2, p.x + 0.2, p.y + 1.82, p.z + 0.2, maxT);
      if (t !== null && t < bestT) { bestT = t; hitBot = null; hitPlayer = true; head = true; }
      t = boxHit(origin, dir, p.x - 0.34, p.y + 0.6, p.z - 0.24, p.x + 0.34, p.y + 1.42, p.z + 0.24, maxT);
      if (t !== null && t < bestT) { bestT = t; hitBot = null; hitPlayer = true; head = false; }
    }
  }

  tmpEnd.copy(origin).addScaledVector(dir, bestT);
  tracer(origin, tmpEnd, kind === 'player' ? PALETTE.teal : PALETTE.amber, def.id === 'sniper' ? 0.14 : 0.08);

  if (hitBot) {
    const base = damageAt(def, bestT);
    const result = bots.damage(hitBot, base, head);
    if (kind === 'player') {
      hud.hitMarker(result.died);
      audio.hit(result.died);
      if (!result.died) state.trauma = Math.min(1, state.trauma + 0.02);
    }
    if (result.died) {
      const killer = kind === 'player' ? { name: 'Kamu', team: 'attackers', isPlayer: true } : shooter;
      onBotKilled(hitBot, killer, def.name);
    }
    return;
  }
  if (hitPlayer) {
    const base = damageAt(def, bestT) * (head ? 2.5 : 1);
    const result = player.damage(base);
    const dx = origin.x - player.state.position.x;
    const dz = origin.z - player.state.position.z;
    const fx = -Math.sin(player.state.yaw), fz = -Math.cos(player.state.yaw);
    const angle = Math.atan2(fx * dz - fz * dx, fx * dx + fz * dz) * 180 / Math.PI;
    hud.damageFrom(angle);
    audio.hurt();
    state.trauma = Math.min(1, state.trauma + 0.42);
    state.fovPunch = 4;
    if (result.died) onPlayerKilled(shooter, def.name);
  }
}

function onBotKilled(bot, killer, weaponName) {
  state.stats.totalKills += 1;
  if (killer.isPlayer) {
    player.state.kills += 1;
    player.state.money += 300;
    state.hitstop = 0.04;
    state.trauma = Math.min(1, state.trauma + 0.3);
    state.fovPunch = 4;
    hud.hitMarker(true);
  } else {
    killer.kills = (killer.kills || 0) + 1;
  }
  hud.killFeed(killer.name, killer.team, bot.name, bot.team, weaponName);
  if (state.bomb.carrier === bot && !state.bomb.planted) dropBomb(bot.position.x, bot.position.z);
  if (killer.team === 'attackers' && !killer.isPlayer) {
    hud.radio(killer.name, `${bot.name} jatuh di ${world.zoneAt(bot.position.x, bot.position.z, bot.position.y)}!`);
  }
}

function onPlayerKilled(killer, weaponName) {
  hud.killFeed(killer.name, killer.team, 'Kamu', 'attackers', weaponName);
  hud.banner('KAMU TEWAS', `${killer.name} · ${weaponName}`, 'lose', 2.6);
  audio.hurt();
  if (state.bomb.carrier === 'player') dropBomb(player.state.position.x, player.state.position.z);
  spectateBot = bots.nearestOf('attackers', player.state.position, null);
  hud.spectate(spectateBot ? spectateBot.name : '');
}

// ---------------------------------------------------------------- rounds, bomb, economy
function siteNear(pos, radiusScale = 1) {
  for (const site of world.sites) {
    if (Math.hypot(pos.x - site.x, pos.z - site.z) < site.radius * radiusScale && pos.y < 2.4) return site;
  }
  return null;
}

function siteById(id) { return world.sites.find((site) => site.id === id); }

function bombY(x, z) { return siteNear({ x, z, y: 0 }, 1.1)?.id === 'B' ? 0.48 : 0.16; }

function dropBomb(x, z) {
  if (state.bomb.planted) return;
  state.bomb.carried = false;
  state.bomb.carrier = null;
  bots.setCarrier(null);
  state.bomb.x = x;
  state.bomb.z = z;
  state.bomb.drop = 2.4;
  bombMesh.visible = true;
  bombMesh.position.set(x, bombY(x, z), z);
  hud.radio('OMBAK', 'Bom jatuh — ambil kembali!');
}

function plantBomb(site, planterName) {
  state.bomb.planted = true;
  state.bomb.carried = false;
  state.bomb.carrier = null;
  bots.setCarrier(null);
  state.bomb.site = site.id;
  state.bomb.x = site.x;
  state.bomb.z = site.z;
  state.bomb.fuse = 35;
  state.bomb.defuse = 0;
  state.bomb.defuseTotal = state.round >= 5 ? 2.5 : 5;
  state.plantProgress = 0;
  state.stats.plants += 1;
  bombMesh.visible = true;
  bombMesh.position.set(site.x, bombY(site.x, site.z), site.z);
  if (planterName === 'Kamu') { player.state.money += 300; hud.banner('BOM DITANAM', site.name.toUpperCase(), 'win', 2.2); }
  hud.radio('OMBAK', `Bom ditanam di ${site.name}!`);
  hud.radio('LENTERA', `Rotasi ke ${site.short}!`);
  audio.plantBeep();
  bots.rotateDefenders({ x: site.x, y: 0, z: site.z }, gameplayRng);
}

function resetBomb() {
  state.bomb = { carried: true, carrier: 'player', planted: false, x: 0, z: 0, site: null, fuse: 35, defuse: 0, defuseTotal: 5, drop: 0 };
  bots.setCarrier(null);
  state.plantProgress = 0;
  bombMesh.visible = false;
}

function startRound() {
  state.round = state.scoreTeal + state.scoreAmber + 1;
  gameplayRng = makeRng(roundSeed(matchSeed, state.round));
  state.plan.attackSite = gameplayRng.chance(0.5) ? 'A' : 'B';
  bots.reset(state.round, gameplayRng, state.plan);
  player.respawn(world.spawns.attackers[0], 0);
  player.state.armour = 0;
  armourBought = false;
  if (isAutoplay) {
    player.state.money = Math.max(player.state.money, 6000);
    for (const id of Object.keys(inventory)) inventory[id] = true;
    currentWeapon = 'rifle';
    armourBought = true;
    player.state.armour = 50;
  }
  refillOwned();
  equipWeapon(currentWeapon);
  resetBomb();
  state.phase = 'buy';
  state.timer = isAutoplay ? 0.8 : 15;
  state.triggerLatch = false;
  state.scoreboardOpen = false;
  spectateBot = null;
  state.plantProgress = 0;
  state.beepTimer = 0;
  hud.setArmourBought(false);
  hud.showBuy(true, player.state.money, currentWeapon, state.timer);
  hud.objective(null);  hud.spectate(null);
  const site = siteById(state.plan.attackSite);
  hud.banner(`RONDE ${state.round}`, `OMBAK menyerang ${site.name.toUpperCase()}`, '', 2.2);
  hud.setScores(state.scoreTeal, state.scoreAmber);
}

function startLive() {
  state.phase = 'live';
  state.timer = state.roundTime;
  hud.showBuy(false);
  hud.setPhase('LIVE', false);
  const site = siteById(state.plan.attackSite);
  hud.radio('OMBAK', `Serang ${site.name}!`);
  audio.radio();
}

function endRound(winner, reason) {
  if (state.phase !== 'live') return;
  state.phase = 'post';
  state.timer = 4.2;
  state.stats.roundsEnded += 1;
  state.stats.lastWinner = winner;
  if (reason.includes('DINETRALKAN')) state.stats.defuses += 1;
  if (reason.includes('MELEDAK')) state.stats.explosions += 1;
  if (winner === 'attackers') state.scoreTeal += 1;
  else state.scoreAmber += 1;
  const playerWon = winner === 'attackers';
  player.state.money += playerWon ? 3250 : 1900;
  state.plantProgress = 0;
  hud.showBuy(false);
  hud.objective(null);
  hud.setScores(state.scoreTeal, state.scoreAmber);
  hud.banner(playerWon ? 'RONDE DIMENANGKAN' : 'RONDE KALAH', `${reason} · ${state.scoreTeal} — ${state.scoreAmber}`, playerWon ? 'win' : 'lose', 4.0);
  audio[playerWon ? 'win' : 'lose']();
  state.trauma = 0.3;
}

function startOver() {
  state.phase = 'over';
  state.timer = 8;
  state.matchOver = true;
  const tealWon = state.scoreTeal >= 7;
  hud.banner(tealWon ? 'OMBAK MENANG' : 'LENTERA MENANG', `PERTANDINGAN SELESAI · ${state.scoreTeal} — ${state.scoreAmber}`, tealWon ? 'win' : 'lose', 8);
  audio[tealWon ? 'win' : 'lose']();
  hud.showBuy(false);
  hud.objective(null);
}

function restartMatch() {
  state.scoreTeal = 0;
  state.scoreAmber = 0;
  state.round = 1;
  player.state.money = 800;
  player.state.kills = 0;
  player.state.deaths = 0;
  player.state.armour = 0;
  for (const key of Object.keys(inventory)) inventory[key] = key === 'pistol';
  currentWeapon = 'pistol';
  refillOwned();
  equipWeapon('pistol');
  armourBought = false;
  state.stats.totalKills = 0;
  state.stats.roundsEnded = 0;
  state.stats.plants = 0;
  state.stats.defuses = 0;
  state.stats.explosions = 0;
  state.matchOver = false;
  for (const bot of bots.bots) { bot.kills = 0; bot.deaths = 0; }
  startRound();
}

function startMatch() {
  restartMatch();
}

// ---------------------------------------------------------------- player controls
function setPlayerAt(x, y, z, yaw, pitch = 0) {
  player.state.position.set(x, y, z);
  player.state.velocity.set(0, 0, 0);
  player.state.yaw = yaw;
  player.state.pitch = pitch;
  player.state.alive = true;
  player.state.health = 100;
  player.state.onGround = true;
}

function placeBot(bot, x, y, z, yaw, alive = true, health = 100) {
  bot.position.set(x, y, z);
  bot.velocity.set(0, 0, 0);
  bot.yaw = yaw;
  bot.pitch = 0;
  bot.alive = alive;
  bot.health = health;
  bot.deadTime = alive ? 0 : 2;
  bot.model.group.visible = true;
  bot.model.group.position.copy(bot.position);
  bot.model.group.rotation.set(alive ? 0 : -1.42, yaw, 0);
  bot.model.tag.visible = alive;
}

function buy(kind) {
  if (state.phase !== 'buy' || !player.state.alive) return;
  if (kind === 'armour') {
    if (armourBought || player.state.money < 650) return;
    player.state.money -= 650;
    player.state.armour = 50;
    armourBought = true;
    audio.buy();
  } else if (WEAPONS[kind]) {
    const price = WEAPONS[kind].price;
    const first = !inventory[kind];
    if (first) {
      if (player.state.money < price) return;
      player.state.money -= price;
      inventory[kind] = true;
    }
    currentWeapon = kind;
    equipWeapon(kind, first);
    audio.buy();
  }
  hud.showBuy(true, player.state.money, currentWeapon, state.timer);
  hud.setArmourBought(armourBought);
}

function switchWeapon(kind) {
  if (!inventory[kind]) return;
  currentWeapon = kind;
  equipWeapon(kind);
}

function playerFire() {
  if (!player.state.alive || state.phase !== 'live' || !weapon.ready()) return false;
  const def = weapon.def();
  weapon.consume();
  weapon.pullTrigger();
  const spread = weapon.spread(player.groundSpeed(), player.state.crouching);
  const cp = Math.cos(player.state.pitch);
  tmpDir.set(-Math.sin(player.state.yaw) * cp, Math.sin(player.state.pitch), -Math.cos(player.state.yaw) * cp);
  tmpDir.x += gameplayRng.range(-spread, spread);
  tmpDir.y += gameplayRng.range(-spread, spread);
  tmpDir.z += gameplayRng.range(-spread, spread);
  tmpDir.normalize();
  player.eye(tmpOrigin);
  fireHitscan('player', null, tmpOrigin, tmpDir, def.id);
  player.recoil(def.kickPitch, gameplayRng.range(-def.kickYaw, def.kickYaw));
  state.trauma = Math.min(1, state.trauma + 0.035);
  audio.shot(def.id);
  return true;
}

function computeAutoControl() {
  autoCtl.forward = false; autoCtl.back = false; autoCtl.left = false; autoCtl.right = false;
  autoCtl.jump = false; autoCtl.crouch = false; autoCtl.firing = false; autoCtl.plant = false;
  if (!player.state.alive) return;
  const p = player.state.position;
  if (state.bomb.carried && state.bomb.carrier === 'player' && !state.bomb.planted) {
    const site = siteNear(p);
    if (site && site.id === state.plan.attackSite) {
      autoCtl.plant = true;
      player.state.yaw = Math.atan2(-(site.x - p.x), -(site.z - p.z));
      player.state.pitch = -0.2;
      return;
    }
  }
  player.eye(tmpA);
  let enemy = null, bestD = Infinity;
  for (const bot of bots.bots) {
    if (bot.team !== 'defenders' || !bot.alive) continue;
    tmpB.set(bot.position.x, bot.position.y + 1.15, bot.position.z);
    const dx = tmpB.x - tmpA.x, dy = tmpB.y - tmpA.y, dz = tmpB.z - tmpA.z;
    const d = Math.hypot(dx, dy, dz);
    if (d < bestD && world.segmentClear(tmpA, tmpB)) { bestD = d; enemy = bot; }
  }
  if (enemy) {
    const dx = enemy.position.x - p.x;
    const dz = enemy.position.z - p.z;
    const dy = (enemy.position.y + 1.15) - (p.y + player.state.eye);
    player.state.yaw = Math.atan2(-dx, -dz);
    player.state.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    autoCtl.firing = true;
    if (!weapon.def().auto && weapon.ready()) state.triggerLatch = false;
    return;
  }
  // choose the objective point
  let tx, tz, key;
  if (state.bomb.planted) { tx = state.bomb.x; tz = state.bomb.z; key = 'bomb'; }
  else if (state.bomb.carried && state.bomb.carrier === 'player') { const site = siteById(state.plan.attackSite); tx = site.x; tz = site.z; key = state.plan.attackSite; }
  else if (!state.bomb.carried) { tx = state.bomb.x; tz = state.bomb.z; key = 'pickup'; }
  else { const site = siteById(state.plan.attackSite); tx = site.x; tz = site.z; key = state.plan.attackSite; }
  const site = siteNear(p);
  if (key === state.plan.attackSite && site && state.bomb.carried && state.bomb.carrier === 'player') {
    autoCtl.plant = true;
    player.state.yaw = Math.atan2(-(tx - p.x), -(tz - p.z));
    player.state.pitch = -0.15;
    return;
  }
  if (autoGoalKey !== key) {
    autoGoalKey = key;
    autoPath = world.findPath(p, { x: tx, y: 0, z: tz });
    autoPath.index = 0;
  }
  let node = autoPath && autoPath[autoPath.index];
  if (!node || Math.hypot(node.x - p.x, node.z - p.z) < 0.9) {
    if (autoPath) autoPath.index += 1;
    node = autoPath && autoPath[autoPath.index];
  }
  if (node) {
    const dx = node.x - p.x, dz = node.z - p.z;
    player.state.yaw = Math.atan2(-dx, -dz);
    player.state.pitch = 0;
    autoCtl.forward = true;
  } else {
    const dx = tx - p.x, dz = tz - p.z;
    player.state.yaw = Math.atan2(-dx, -dz);
    autoCtl.forward = Math.hypot(dx, dz) > 1.2;
  }
}

function updatePlayer(dt, canShoot) {
  let forward = false, back = false, left = false, right = false, jump = false, crouch = false, firing = false, plant = false;
  if (isAutoplay) {
    computeAutoControl();
    forward = autoCtl.forward; back = autoCtl.back; left = autoCtl.left; right = autoCtl.right;
    jump = autoCtl.jump; crouch = autoCtl.crouch; firing = autoCtl.firing; plant = autoCtl.plant;
  } else {
    forward = input.keys.has('KeyW'); back = input.keys.has('KeyS');
    left = input.keys.has('KeyA'); right = input.keys.has('KeyD');
    jump = input.keys.has('Space');
    crouch = input.keys.has('ControlLeft') || input.keys.has('ControlRight') || input.keys.has('KeyC');
    firing = input.firing;
    plant = input.keys.has('KeyE');
  }
  if (!player.state.alive) return;
  moveInput.forward = forward; moveInput.back = back; moveInput.left = left; moveInput.right = right;
  moveInput.jump = jump; moveInput.crouch = crouch;
  player.step(dt, moveInput);
  if (player.state.position.y < -0.9) {
    player.state.position.set(world.spawns.attackers[0].x, 0, world.spawns.attackers[0].z);
    player.state.velocity.set(0, 0, 0);
    player.damage(22);
    hud.radio('OMBAK', 'Jatuh ke laguna!');
    if (!player.state.alive) onPlayerKilled({ name: 'Laguna', team: 'defenders' }, 'air');
  }
  state.footTimer -= dt;
  if (player.state.onGround && player.groundSpeed() > 1.6 && state.footTimer <= 0) {
    state.footTimer = player.state.crouching ? 0.58 : 0.4;
    audio.footstep();
  }
  if (canShoot && firing) {
    const def = weapon.def();
    if (def.auto || !state.triggerLatch) {
      if (playerFire()) state.triggerLatch = true;
    }
  } else state.triggerLatch = false;

  if (weapon.state.mag === 0 && weapon.state.reloadLeft === 0) {
    if (weapon.state.reserve > 0) { weapon.reload(); audio.reload(); }
    else if (currentWeapon !== 'pistol' && inventory.pistol) switchWeapon('pistol');
  }

  if (plant && state.bomb.carried && state.bomb.carrier === 'player' && !state.bomb.planted) {
    const site = siteNear(player.state.position);
    if (site && player.groundSpeed() < 2.2) {
      state.plantProgress += dt;
      hud.objective(`MENANAM BOM · ${site.name.toUpperCase()}`, state.plantProgress / 3.5, 'plant');
      state.beepTimer -= dt;
      if (state.beepTimer <= 0) { state.beepTimer = 0.55; audio.plantBeep(); }
      if (state.plantProgress >= 3.5) plantBomb(site, 'Kamu');
      return;
    }
  }
  if (!state.bomb.planted && state.bomb.carrier === 'player') { state.plantProgress = 0; hud.objective(null); }
}

// ---------------------------------------------------------------- simulation
const botCtx = {
  now: 0, rng: gameplayRng, playerAlive: true, playerTeam: 'attackers',
  playerEye: new THREE.Vector3(), playerChest: new THREE.Vector3(), camera: camera.position,
  onBotFire(bot, origin, dir) {
    if (state.phase !== 'live') return;
    const dist = Math.hypot(bot.position.x - player.state.position.x, bot.position.z - player.state.position.z);
    if (dist < 32) audio.shot(bot.weapon);
    tmpOrigin.set(origin.x, origin.y, origin.z);
    tmpDir.set(dir.x, dir.y, dir.z);
    fireHitscan('bot', bot, tmpOrigin, tmpDir, bot.weapon);
  },
  onContact(bot, zone) {
    hud.radio(bot.name, `Kontak di ${zone}!`);
    audio.radio();
  },
};

function stepBombDefuse(dt) {
  if (!state.bomb.planted) return;
  state.bomb.fuse -= dt;
  const defuseSite = siteById(state.bomb.site);
  let defuser = null;
  for (const bot of bots.bots) {
    if (bot.team !== 'defenders' || !bot.alive) continue;
    if (Math.hypot(bot.position.x - state.bomb.x, bot.position.z - state.bomb.z) < 5.2) { defuser = bot; break; }
  }
  if (defuser) {
    state.bomb.defuse += dt;
    hud.objective('MENETRALKAN BOM', state.bomb.defuse / state.bomb.defuseTotal, 'defuse');
    state.beepTimer -= dt;
    if (state.beepTimer <= 0) { state.beepTimer = 0.45; audio.defuseTick(); }
    if (state.bomb.defuse >= state.bomb.defuseTotal) {
      endRound('defenders', `BOM DINETRALKAN · ${defuseSite?.short ?? ''}`);
      return;
    }
  } else {
    state.bomb.defuse = Math.max(0, state.bomb.defuse - dt * 0.6);
    hud.objective(null);
  }
  if (state.bomb.fuse <= 0 && state.phase === 'live') {
    audio.explode();
    state.trauma = 1;
    state.fovPunch = 6;
    endRound('attackers', 'BOM MELEDAK');
  }
}

function simulate(dt) {
  if (state.paused || state.frozen) return;
  state.elapsed += dt;
  weapon.advance(dt);
  if (state.phase === 'buy') {
    updatePlayer(dt, false);
    state.timer -= dt;
    if (state.timer <= 0) startLive();
    return;
  }
  if (state.phase === 'post') {
    state.timer -= dt;
    if (state.timer <= 0) {
      if (state.scoreTeal >= 7 || state.scoreAmber >= 7) startOver();
      else startRound();
    }
    return;
  }
  if (state.phase === 'over') {
    state.timer -= dt;
    if (state.timer <= 0) restartMatch();
    return;
  }
  if (state.phase !== 'live') return;

  botCtx.now = state.elapsed;
  botCtx.rng = gameplayRng;
  player.eye(botCtx.playerEye);
  botCtx.playerChest.set(player.state.position.x, player.state.position.y + 1.2, player.state.position.z);
  botCtx.playerAlive = player.state.alive;
  bots.step(dt, botCtx);

  if (player.state.alive) updatePlayer(dt, true);
  else if (!spectateBot || !spectateBot.alive) spectateBot = bots.nearestOf('attackers', player.state.position, null);

  // bomb carrier / drop recovery
  if (!state.bomb.planted) {
    if (state.bomb.carried && state.bomb.carrier !== 'player') {
      const carrier = state.bomb.carrier;
      if (!carrier.alive) {
        dropBomb(carrier.position.x, carrier.position.z);
      } else {
        const site = siteNear(carrier.position);
        if (site) {
          state.plantProgress += dt;
          hud.objective(`MENANAM BOM · ${site.name.toUpperCase()}`, state.plantProgress / 3.5, 'plant');
          state.beepTimer -= dt;
          if (state.beepTimer <= 0) { state.beepTimer = 0.55; audio.plantBeep(); }
          if (state.plantProgress >= 3.5) plantBomb(site, carrier.name);
        } else if (state.plantProgress > 0) {
          state.plantProgress = 0;
          hud.objective(null);
        }
      }
    } else if (!state.bomb.carried && state.bomb.drop > 0) {
      state.bomb.drop -= dt;
      if (state.bomb.drop <= 0) {
        if (player.state.alive && Math.hypot(player.state.position.x - state.bomb.x, player.state.position.z - state.bomb.z) < 3) {
          state.bomb.carried = true; state.bomb.carrier = 'player'; bots.setCarrier(null); bombMesh.visible = false;
          hud.radio('KAMU', 'Bom diambil.');
        } else {
          const bot = bots.nearestOf('attackers', { x: state.bomb.x, z: state.bomb.z }, null);
          if (bot) {
            state.bomb.carried = true; state.bomb.carrier = bot; bots.setCarrier(bot);
            const site = siteById(state.plan.attackSite);
            bots.sendTo(bot, [{ x: site.x, y: 0, z: site.z }]);
            bombMesh.visible = false;
            hud.radio(bot.name, `Bom diambil — menuju ${site.short}!`);
          }
        }
      }
    }
    if (!state.bomb.planted) {
      state.timer -= dt;
      if (state.timer <= 0) { endRound('defenders', 'WAKTU HABIS'); return; }
    }
  } else {
    stepBombDefuse(dt);
    if (state.phase !== 'live') return;
  }

  const atkAlive = (player.state.alive ? 1 : 0) + bots.countAlive('attackers');
  const defAlive = bots.countAlive('defenders');
  if (defAlive === 0) endRound('attackers', 'ELIMINASI');
  else if (atkAlive === 0 && !state.bomb.planted) endRound('defenders', 'ELIMINASI');
}

// ---------------------------------------------------------------- frame / camera / HUD
function syncCamera() {
  if (player.state.alive) {
    player.eye(tmpOrigin);
    camera.position.copy(tmpOrigin);
    camera.rotation.set(player.state.pitch, player.state.yaw, 0, 'YXZ');
  } else {
    const bot = spectateBot;
    if (bot && bot.alive) {
      camera.position.set(bot.position.x, bot.position.y + 1.55, bot.position.z);
      camera.rotation.set(0, bot.yaw, 0, 'YXZ');
    } else {
      camera.position.set(0, 8, 24);
      camera.rotation.set(-0.5, 0, 0, 'YXZ');
    }
  }
  const shake = state.trauma * state.trauma;
  if (shake > 0.0005) {
    camera.position.x += (visualRng.next() * 2 - 1) * shake * 0.07;
    camera.position.y += (visualRng.next() * 2 - 1) * shake * 0.05;
    camera.rotation.z += (visualRng.next() * 2 - 1) * shake * 0.05;
  }
  const targetFov = 74 + state.fovPunch;
  if (Math.abs(camera.fov - targetFov) > 0.01) {
    camera.fov = targetFov;
    camera.updateProjectionMatrix();
  }
}

function updateVisual(dt) {
  state.trauma = Math.max(0, state.trauma - 1.4 * dt);
  state.fovPunch = Math.max(0, state.fovPunch - 20 * dt);
  for (const t of tracers) {
    if (t.life > 0) {
      t.life -= dt;
      if (t.life <= 0) { t.line.visible = false; t.line.material.opacity = 0; }
      else t.line.material.opacity = Math.min(0.95, (t.life / t.max) * 0.95);
    }
  }
  if (bombMesh.visible) {
    bombMesh.rotation.y = state.elapsed * 0.6;
    bombLight.material.color.set(Math.sin(state.elapsed * 9) > 0 ? PALETTE.amber : PALETTE.ember);
  }
  weapon.step(dt, player.groundSpeed());
  world.update(state.elapsed, dt);
  hud.tick(dt);
}

function scoreRows() {
  const rows = [{ name: 'Kamu', team: 'attackers', kills: player.state.kills, deaths: player.state.deaths, money: player.state.money, you: true }];
  for (const bot of bots.bots) rows.push({ name: bot.name, team: bot.team, kills: bot.kills, deaths: bot.deaths, money: 0 });
  return rows;
}

function refreshHud() {
  hud.setScores(state.scoreTeal, state.scoreAmber);
  hud.setRound(state.round);
  hud.setTimer(state.bomb.planted ? state.bomb.fuse : state.timer, state.bomb.planted);
  const phaseText = state.phase === 'buy' ? 'BUY PHASE' : state.phase === 'live' ? (state.bomb.planted ? 'BOM AKTIF' : 'LIVE') : state.phase === 'post' ? 'ROUND OVER' : 'MATCH OVER';
  hud.setPhase(phaseText, state.phase === 'post');
  hud.setVitals(player.state.health, player.state.armour, player.state.money);
  const def = weapon.def();
  hud.setWeapon(def.name, weapon.state.mag, weapon.state.reserve, weapon.state.id, inventory);
  hud.setReloadHint(weapon.state.reloadLeft > 0 ? 'RELOADING' : weapon.state.mag === 0 ? 'PRESS R TO RELOAD' : '');
  hud.setSpread(weapon.spread(player.groundSpeed(), player.state.crouching));
  hud.setArmourBought(armourBought);
  hud.showBuy(state.phase === 'buy' && !isShot, player.state.money, currentWeapon, state.timer);
  hud.scoreboard(scoreRows(), state.scoreboardOpen);
  if (!player.state.alive) {
    if (!spectateBot || !spectateBot.alive) spectateBot = bots.nearestOf('attackers', player.state.position, null);
    hud.spectate(spectateBot ? spectateBot.name : '');
  } else hud.spectate(null);
  const mates = [{ x: player.state.position.x, z: player.state.position.z, alive: player.state.alive, you: true }];
  for (const bot of bots.bots) if (bot.team === 'attackers') mates.push({ x: bot.position.x, z: bot.position.z, alive: bot.alive, you: false });
  hud.minimap(player.state.position.x, player.state.position.z, player.state.yaw, mates, [], world.sites, state.bomb, player.state.alive, state.elapsed);
  if (state.bomb.planted) bombMesh.position.set(state.bomb.x, bombY(state.bomb.x, state.bomb.z), state.bomb.z);
}

function frame(now) {
  requestAnimationFrame(frame);
  lookStep();
  const raw = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!state.frozen) {
    let gdt = raw;
    if (state.hitstop > 0) { state.hitstop = Math.max(0, state.hitstop - raw); gdt = raw * 0.06; }
    accumulator += gdt;
    const speed = isAutoplay ? Math.min(12, Math.max(1, Number(params.get('speed')) || 1)) : 1;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 6 * speed) {
      simulate(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (steps >= 6 * speed) accumulator = 0;
    updateVisual(raw);
    refreshHud();
  }
  syncCamera();
  renderer.render(scene, camera);
}

function summary() {
  return {
    phase: state.phase,
    round: state.round,
    scoreTeal: state.scoreTeal,
    scoreAmber: state.scoreAmber,
    timer: Number(state.timer.toFixed(2)),
    playerAlive: player.state.alive,
    playerKills: player.state.kills,
    playerDeaths: player.state.deaths,
    totalKills: state.stats.totalKills,
    roundsEnded: state.stats.roundsEnded,
    plants: state.stats.plants,
    defuses: state.stats.defuses,
    explosions: state.stats.explosions,
    aliveAttackers: (player.state.alive ? 1 : 0) + bots.countAlive('attackers'),
    aliveDefenders: bots.countAlive('defenders'),
    bombPlanted: state.bomb.planted,
    bombFuse: Number(state.bomb.fuse.toFixed(2)),
    plan: state.plan.attackSite,
    seed: matchSeed,
    elapsed: Number(state.elapsed.toFixed(2)),
  };
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    updateVisual(0);
    refreshHud();
    syncCamera();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      state.frozen = true;
      window.__shotReady = true;
    }
  }
  requestAnimationFrame(paint);
}

function runSim() {
  state.paused = false;
  const steps = Math.round(simSeconds * 60);
  for (let i = 0; i < steps; i += 1) simulate(FIXED_STEP);
  state.frozen = true;
  updateVisual(0);
  refreshHud();
  syncCamera();
  renderer.render(scene, camera);
  window.__apung = { summary, state, game };
  window.__apungDone = summary();
  window.__shotReady = true;
}

// ---------------------------------------------------------------- input
function setKey(code, down) {
  if (down) input.keys.add(code); else input.keys.delete(code);
  if (code === 'Tab') input.keys.delete('Tab');
}
window.addEventListener('keydown', (event) => {
  if (event.code === 'Tab') { state.scoreboardOpen = true; event.preventDefault(); }
  if (event.code === 'Space') event.preventDefault();
  if (event.repeat) return;
  if (event.code === 'KeyR') { weapon.reload(); audio.reload(); return; }
  if (state.phase === 'buy') {
    const map = { Digit1: 'pistol', Digit2: 'smg', Digit3: 'rifle', Digit4: 'sniper', Digit5: 'armour' };
    if (map[event.code]) { buy(map[event.code]); return; }
  } else if (state.phase === 'live' || state.phase === 'post') {
    const map = { Digit1: 'pistol', Digit2: 'smg', Digit3: 'rifle', Digit4: 'sniper' };
    if (map[event.code]) { switchWeapon(map[event.code]); return; }
  }
  setKey(event.code, true);
});
window.addEventListener('keyup', (event) => {
  if (event.code === 'Tab') state.scoreboardOpen = false;
  setKey(event.code, false);
});
window.addEventListener('blur', () => { input.keys.clear(); input.firing = false; });
window.addEventListener('mousemove', (event) => {
  if (!input.locked) return;
  input.lookX += event.movementX;
  input.lookY += event.movementY;
});
window.addEventListener('mousedown', (event) => {
  if (input.locked && event.button === 0) input.firing = true;
});
window.addEventListener('mouseup', (event) => {
  if (event.button === 0) { input.firing = false; state.triggerLatch = false; }
});
document.addEventListener('pointerlockchange', () => {
  input.locked = document.pointerLockElement === renderer.domElement;
  if (isShot || isSim) return;
  if (input.locked) {
    state.paused = false; state.started = true;
    hud.hideOverlay(); hud.setPaused(false);
  } else if (state.started && state.phase !== 'over') {
    state.paused = true;
    input.keys.clear(); input.firing = false;
    hud.setPaused(true); hud.showOverlay();
  }
});
hud.onPlay(() => {
  if (isShot) return;
  audio.resume();
  state.started = true;
  state.paused = false;
  hud.hideOverlay();
  hud.setPaused(false);
  if (!state.matchOver) renderer.domElement.requestPointerLock?.();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

function lookStep() {
  if (!input.locked || isAutoplay) return;
  player.look(input.lookX, input.lookY);
  input.lookX = 0; input.lookY = 0;
}

// look is applied once per rendered frame, but movement/fire stay on the fixed step

// ---------------------------------------------------------------- boot
const game = {
  scene, camera, renderer, world, player, bots, weapon, hud, audio, state, inventory,
  tracer, bombMesh,
  get currentWeapon() { return currentWeapon; },
  startMatch, startRound, startLive, restartMatch, endRound,
  forceLive() { if (state.phase === 'buy') startLive(); },
  setPlayerAt, placeBot, refreshHud, syncCamera, paintTwiceThenReady, summary,
  stageShot(name) { stageShot(name, game); },
  setWeapon(id) { inventory[id] = true; currentWeapon = id; ammoMap[id] = { mag: WEAPONS[id].mag, reserve: WEAPONS[id].reserve }; equipWeapon(id); },
  setBombAt(x, z) { state.bomb.planted = true; state.bomb.carried = false; state.bomb.x = x; state.bomb.z = z; bombMesh.visible = true; bombMesh.position.set(x, bombY(x, z), z); },
  clearBomb() { resetBomb(); },
  render() { updateVisual(0); refreshHud(); syncCamera(); renderer.render(scene, camera); },
};

if (!isShot && !isSim) {
  startMatch();
  state.paused = true;
  hud.hideOverlay();
  hud.showOverlay();
  audio.resume();
  requestAnimationFrame(frame);
} else if (isSim) {
  hud.hideOverlay();
  hud.setPaused(false);
  startMatch();
  if (isBombTest) {
    const site = world.sites[0];
    state.phase = 'live';
    state.timer = 100;
    state.plan.attackSite = 'A';
    setPlayerAt(site.x, 0, site.z, 0, -0.1);
    const defs = bots.bots.filter((b) => b.team === 'defenders');
    defs.forEach((b, i) => placeBot(b, 0, 0, -28 + i * 1.2, 0));
    const atks = bots.bots.filter((b) => b.team === 'attackers');
    atks.forEach((b, i) => placeBot(b, site.x - 4 + i * 2, 0, site.z + 6, Math.PI));
  }
  runSim();
} else {
  startMatch();
  stageShot(shotName, game);
  paintTwiceThenReady();
}

window.addEventListener('error', (event) => {
  window.__apungError = String(event.message || event.error || 'error');
});
