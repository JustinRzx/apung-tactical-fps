// The two bot squads. Each bot follows an authored lane route to a round goal, watches for enemies
// with an AABB line-of-sight test, waits out a 350–700 ms reaction, and fires with spread.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { moveBody } from './player.js';
import { WEAPONS } from './weapon.js';

const NAMES_ATTACK = ['Budi', 'Sari', 'Agus', 'Dewi'];
const NAMES_DEFEND = ['Rina', 'Joko', 'Maya', 'Eko', 'Putri'];
const MAX_RANGE = 54;

function teamColor(team) {
  return team === 'attackers' ? PALETTE.teal : PALETTE.amber;
}

function makeTag(name, team) {
  const canvas = document.createElement('canvas');
  canvas.width = 256; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = 'rgba(10,14,20,0.55)';
  ctx.beginPath(); ctx.roundRect(28, 10, 200, 44, 8); ctx.fill();
  ctx.strokeStyle = teamColor(team); ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = teamColor(team);
  ctx.font = 'bold 28px ui-monospace, monospace';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(name.toUpperCase(), 128, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false }));
  sprite.scale.set(1.9, 0.475, 1);
  sprite.position.set(0, 2.18, 0);
  return sprite;
}

function buildModel(team, name) {
  const group = new THREE.Group();
  const color = new THREE.MeshStandardMaterial({ color: teamColor(team), roughness: 0.68, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: PALETTE.night, roughness: 0.9 });
  const skin = new THREE.MeshStandardMaterial({ color: '#c9a37e', roughness: 0.85 });
  const vest = new THREE.MeshStandardMaterial({ color: team === 'attackers' ? PALETTE.tealDeep : PALETTE.amberDeep, roughness: 0.75 });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.36), color);
  torso.position.y = 1.08;
  const vestMesh = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.42, 0.4), vest);
  vestMesh.position.y = 1.12;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.34, 0.34), skin);
  head.position.y = 1.62;
  const cap = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.1, 0.38), dark);
  cap.position.y = 1.83;
  const armL = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.58, 0.2), color);
  armL.position.set(-0.4, 1.12, 0);
  const armR = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.58, 0.2), color);
  armR.position.set(0.4, 1.12, 0);
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.24), dark);
  legL.position.set(-0.16, 0.36, 0);
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.72, 0.24), dark);
  legR.position.set(0.16, 0.36, 0);
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.62), dark);
  gun.position.set(0.28, 1.12, -0.36);
  const muzzle = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.24), new THREE.MeshBasicMaterial({ color: PALETTE.lantern, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }));
  muzzle.position.set(0.28, 1.12, -0.7);
  muzzle.visible = false;
  for (const mesh of [torso, vestMesh, head, cap, armL, armR, legL, legR, gun]) {
    mesh.castShadow = true; mesh.receiveShadow = true;
  }
  const tag = makeTag(name, team);
  group.add(torso, vestMesh, head, cap, armL, armR, legL, legR, gun, muzzle, tag);
  return { group, legL, legR, armL, armR, muzzle, tag };
}

export function createBots(scene, world) {
  const bots = [];
  const all = [];

  function makeBot(name, team, index) {
    const model = buildModel(team, name);
    scene.add(model.group);
    const bot = {
      name, team, index, model,
      position: new THREE.Vector3(), velocity: new THREE.Vector3(), yaw: 0, pitch: 0,
      height: 1.72, onGround: true,
      health: 100, armour: 0, alive: true, kills: 0, deaths: 0,
      weapon: 'pistol', path: [], pathIndex: 0, goal: null, explore: null,
      target: null, targetSeen: -99, reactionUntil: 0, lastSeen: new THREE.Vector3(),
      fireCooldown: 0, muzzle: 0, deadTime: 0, stuck: 0, lastPos: new THREE.Vector3(),
      scan: 0, strafe: 0, strafeDir: 1, holdYaw: 0, planting: false, defusing: false,
      carrier: false, role: 'site', visibleTick: 0, calloutAt: -99, aimPoint: new THREE.Vector3(),
    };
    bots.push(bot);
    all.push(bot);
    return bot;
  }

  for (let i = 0; i < NAMES_ATTACK.length; i += 1) makeBot(NAMES_ATTACK[i], 'attackers', i);
  for (let i = 0; i < NAMES_DEFEND.length; i += 1) makeBot(NAMES_DEFEND[i], 'defenders', i);

  function assignPath(bot, points) {
    const path = [];
    let from = { x: bot.position.x, y: bot.position.y, z: bot.position.z };
    for (const point of points) {
      const leg = world.findPath(from, point);
      for (const node of leg) {
        const last = path[path.length - 1];
        if (!last || Math.hypot(last.x - node.x, last.z - node.z) > 0.05 || Math.abs(last.y - node.y) > 0.05) path.push({ x: node.x, y: node.y, z: node.z });
      }
      from = point;
    }
    bot.path = path;
    bot.pathIndex = 0;
    bot.goal = points[points.length - 1] ?? null;
    bot.stuck = 0;
  }

  function siteById(id) {
    return world.sites.find((site) => site.id === id);
  }

  function reset(round, rng, plan) {
    const lists = { attackers: bots.filter((b) => b.team === 'attackers'), defenders: bots.filter((b) => b.team === 'defenders') };
    for (const team of ['attackers', 'defenders']) {
      const spawns = world.spawns[team];
      lists[team].forEach((bot, i) => {
        const spawn = spawns[i + 1] ?? spawns[0];
        bot.position.set(spawn.x, spawn.y, spawn.z);
        bot.velocity.set(0, 0, 0);
        bot.yaw = team === 'attackers' ? 0 : Math.PI;
        bot.pitch = 0;
        bot.health = 100;
        bot.armour = round >= 3 ? 50 : 0;
        bot.alive = true;
        bot.deadTime = 0;
        bot.path = [];
        bot.pathIndex = 0;
        bot.target = null;
        bot.targetSeen = -99;
        bot.reactionUntil = 0;
        bot.fireCooldown = rng.range(0.1, 0.5);
        bot.muzzle = 0;
        bot.stuck = 0;
        bot.planting = false;
        bot.defusing = false;
        bot.carrier = false;
        bot.visibleTick = 0;
        bot.calloutAt = -99;
        bot.model.group.visible = true;
        bot.model.group.rotation.set(0, bot.yaw, 0);
        bot.model.group.position.copy(bot.position);
        bot.model.tag.visible = true;
        bot.model.legL.rotation.x = 0; bot.model.legR.rotation.x = 0;
        // loadout: round 1 pistols, then rifles / one DMR, SMG for close bots
        if (round === 1) bot.weapon = 'pistol';
        else if (team === 'defenders' && i === 0) bot.weapon = 'sniper';
        else if (i === 2) bot.weapon = 'smg';
        else bot.weapon = 'rifle';
      });
    }

    const attackSite = siteById(plan.attackSite);
    const otherSite = siteById(plan.attackSite === 'A' ? 'B' : 'A');
    const sitePoint = { x: attackSite.x, y: 0, z: attackSite.z };
    const otherPoint = { x: otherSite.x, y: 0, z: otherSite.z };
    const midPoint = { x: 0, y: 0, z: -2 };
    const eastGate = { x: 20, y: 0, z: 2 };
    const westGate = { x: -20, y: 0, z: 2 };

    // attackers: 2 to the site, 1 mid, 1 fake on the other lane (player is the fifth)
    for (const bot of lists.attackers) {
      if (bot.index <= 1) {
        bot.role = 'site';
        bot.holdYaw = Math.PI;
        assignPath(bot, plan.attackSite === 'A'
          ? [{ x: 20, y: 0, z: 14 }, { x: 23, y: 0, z: 0 }, sitePoint]
          : [{ x: -20, y: 0, z: 14 }, { x: -23, y: 0, z: 0 }, sitePoint]);
      } else if (bot.index === 2) {
        bot.role = 'mid';
        bot.holdYaw = Math.PI;
        assignPath(bot, [midPoint]);
      } else {
        bot.role = 'fake';
        bot.holdYaw = Math.PI * 0.5;
        assignPath(bot, [plan.attackSite === 'A' ? westGate : eastGate, otherPoint]);
      }
    }

    // defenders: 2 A, 2 B, 1 mid; one A and one B hold the rooftop
    const holds = [
      { x: 27.5, y: 3.0, z: -11 }, { x: 24, y: 0, z: -15 },
      { x: -27.5, y: 3.0, z: -11 }, { x: -24, y: 0, z: -15 },
      { x: 0, y: 0, z: -5 },
    ];
    lists.defenders.forEach((bot, i) => {
      const hold = holds[i];
      bot.role = i === 4 ? 'mid' : (i % 2 === 0 ? 'roof' : 'ground');
      bot.holdYaw = i < 2 ? Math.PI : 0;
      assignPath(bot, [hold]);
    });
  }

  function rotateDefenders(sitePoint, rng) {
    for (const bot of bots) {
      if (bot.team !== 'defenders' || !bot.alive) continue;
      if (Math.hypot(bot.position.x - sitePoint.x, bot.position.z - sitePoint.z) < 9) continue;
      const jitter = { x: sitePoint.x + rng.range(-2.5, 2.5), y: 0, z: sitePoint.z + rng.range(-2.5, 2.5) };
      assignPath(bot, [jitter]);
      bot.target = null;
    }
  }

  function alert(team, point, rng) {
    let closest = null, best = Infinity;
    for (const bot of bots) {
      if (bot.team !== team || !bot.alive) continue;
      const d = Math.hypot(bot.position.x - point.x, bot.position.z - point.z);
      if (d > 8 && d < best) { best = d; closest = bot; }
      if (d < 22) {
        bot.lastSeen.copy(point);
        if (!bot.target) bot.holdYaw = Math.atan2(-(point.x - bot.position.x), -(point.z - bot.position.z));
      }
    }
    if (closest && team === 'defenders' && rng.chance(0.45)) {
      assignPath(closest, [{ x: point.x + rng.range(-2, 2), y: 0, z: point.z + rng.range(-2, 2) }]);
    }
  }

  function setCarrier(bot) {
    for (const other of bots) if (other.team === 'attackers') other.carrier = false;
    if (bot) bot.carrier = true;
  }

  function damage(bot, amount, headshot) {
    if (!bot.alive) return { died: false };
    let health = amount * (headshot ? 2.5 : 1);
    if (bot.armour > 0) {
      const soaked = Math.min(bot.armour, health * 0.5);
      bot.armour = Math.max(0, bot.armour - soaked);
      health *= 0.58;
    }
    bot.health -= health;
    if (bot.health <= 0) {
      bot.alive = false;
      bot.deaths += 1;
      bot.deadTime = 0;
      bot.target = null;
      bot.path = [];
      return { died: true };
    }
    return { died: false };
  }

  const enemyEye = new THREE.Vector3();
  const eye = new THREE.Vector3();
  const dir = new THREE.Vector3();

  function eyeOf(bot, out) {
    return out.set(bot.position.x, bot.position.y + 1.55, bot.position.z);
  }

  function facing(bot, target) {
    return Math.atan2(-(target.x - bot.position.x), -(target.z - bot.position.z));
  }

  function step(dt, ctx) {
    const now = ctx.now;
    for (const bot of bots) {
      // dead: fall over, keep the corpse for the round
      if (!bot.alive) {
        bot.deadTime += dt;
        const t = Math.min(1, bot.deadTime / 0.4);
        bot.model.group.rotation.x = -t * 1.42;
        bot.model.tag.visible = false;
        bot.model.muzzle.visible = false;
        continue;
      }

      // animate + timers
      bot.fireCooldown = Math.max(0, bot.fireCooldown - dt);
      bot.muzzle = Math.max(0, bot.muzzle - dt);
      bot.model.muzzle.visible = bot.muzzle > 0;
      bot.scan -= dt; bot.strafe -= dt; bot.visibleTick -= dt;

      // pick a visible enemy every 0.12 s
      if (bot.scan <= 0) {
        bot.scan = 0.12;
        let best = null, bestD = MAX_RANGE;
        const candidates = [];
        if (bot.team === 'defenders') {
          if (ctx.playerAlive && ctx.playerTeam === 'attackers') candidates.push({ kind: 'player', pos: ctx.playerEye, name: 'Kamu' });
          for (const other of bots) if (other.team === 'attackers' && other.alive) candidates.push({ kind: 'bot', bot: other, pos: eyeOf(other, enemyEye), name: other.name });
        } else {
          for (const other of bots) {
            if (other.team !== 'defenders' || !other.alive) continue;
            candidates.push({ kind: 'bot', bot: other, name: other.name, pos: new THREE.Vector3(other.position.x, other.position.y + 1.55, other.position.z) });
          }
        }
        eyeOf(bot, eye);
        const fx = -Math.sin(bot.yaw), fz = -Math.cos(bot.yaw);
        for (const c of candidates) {
          const dx = c.pos.x - eye.x, dy = c.pos.y - eye.y, dz = c.pos.z - eye.z;
          const d = Math.hypot(dx, dy, dz);
          if (d > MAX_RANGE || d >= bestD) continue;
          const dot = (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1);
          if (d > 5 && dot < -0.15) continue;
          if (!world.segmentClear(eye, c.pos)) continue;
          best = c; bestD = d;
        }
        if (best) {
          const wasEmpty = !bot.target;
          if (!bot.target || (best.kind === 'bot' && bot.target.bot !== best.bot) || (best.kind === 'player' && bot.target.kind !== 'player')) {
            const reaction = ctx.rng.range(0.35, 0.7);
            bot.reactionUntil = Math.max(bot.reactionUntil, now + reaction);
            bot.target = best;
            if (wasEmpty && now - bot.calloutAt > 6 && ctx.rng.chance(0.6)) {
              bot.calloutAt = now;
              ctx.onContact(bot, world.zoneAt(bot.position.x, bot.position.z, bot.position.y));
            }
          } else {
            bot.target = best;
          }
          bot.targetSeen = now;
          bot.lastSeen.copy(best.pos);
        } else if (now - bot.targetSeen > 0.8) {
          bot.target = null;
        }
      }

      // engage / move
      let wishX = 0, wishZ = 0, speed = 4.55;
      const target = bot.target;
      if (target) {
        const base = target.kind === 'player' ? ctx.playerChest : eyeOf(target.bot, enemyEye);
        const tpos = bot.aimPoint;
        tpos.set(base.x, base.y - 0.42, base.z); // aim at the chest: headshots stay earned
        const wantYaw = facing(bot, tpos);
        let delta = wantYaw - bot.yaw;
        while (delta > Math.PI) delta -= Math.PI * 2;
        while (delta < -Math.PI) delta += Math.PI * 2;
        bot.yaw += Math.max(-6 * dt, Math.min(6 * dt, delta));
        const dy = tpos.y - (bot.position.y + 1.55);
        bot.pitch = Math.atan2(dy, Math.hypot(tpos.x - bot.position.x, tpos.z - bot.position.z));

        const dist = Math.hypot(tpos.x - bot.position.x, tpos.z - bot.position.z);
        if (now >= bot.reactionUntil && dist < MAX_RANGE) {
          // strafe in short bursts so the fight reads as movement, not turrets
          if (bot.strafe <= 0) { bot.strafe = ctx.rng.range(0.4, 1.0); bot.strafeDir = ctx.rng.chance(0.5) ? -1 : 1; }
          const sideX = Math.cos(bot.yaw) * bot.strafeDir;
          const sideZ = -Math.sin(bot.yaw) * bot.strafeDir;
          wishX = sideX; wishZ = sideZ; speed = 2.1;
          if (bot.fireCooldown <= 0) {
            const weapon = WEAPONS[bot.weapon];
            // aim error grows with distance; seeded per shot
            const error = (weapon.spreadStill + 0.008) * (1 + dist / 42) + (bot.weapon === 'sniper' ? 0.002 : 0.006);
            eyeOf(bot, eye);
            dir.set(tpos.x - eye.x, tpos.y - eye.y, tpos.z - eye.z).normalize();
            dir.x += ctx.rng.range(-error, error);
            dir.y += ctx.rng.range(-error * 0.7, error * 0.7);
            dir.z += ctx.rng.range(-error, error);
            dir.normalize();
            bot.fireCooldown = weapon.fireGap + (weapon.auto ? 0 : ctx.rng.range(0.05, 0.16));
            bot.muzzle = 0.075;
            ctx.onBotFire(bot, { x: eye.x, y: eye.y, z: eye.z }, { x: dir.x, y: dir.y, z: dir.z });
          }
        }
      } else {
        // follow the current lane path
        const node = bot.path[bot.pathIndex];
        if (node) {
          const dx = node.x - bot.position.x, dz = node.z - bot.position.z;
          const dy = node.y - bot.position.y;
          const flat = Math.hypot(dx, dz);
          if (flat < 0.7 && Math.abs(dy) < 0.8) {
            bot.pathIndex += 1;
          } else {
            wishX = dx / (flat || 1); wishZ = dz / (flat || 1);
            speed = bot.pathIndex > bot.path.length * 0.75 ? 3.4 : 4.55;
            if (Math.abs(dy) > 0.3) bot.yaw = Math.atan2(-dx, -dz);
            else bot.yaw = Math.atan2(-dx, -dz);
          }
        } else {
          // hold: face the likely approach, shift weight now and then
          bot.yaw += Math.max(-1.4 * dt, Math.min(1.4 * dt, ((bot.holdYaw - bot.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI));
          if (bot.strafe <= 0) { bot.strafe = ctx.rng.range(0.7, 1.6); bot.strafeDir = ctx.rng.chance(0.5) ? -1 : 1; }
        }
      }

      // movement solver (same authored AABBs as the player)
      const beforeX = bot.position.x, beforeZ = bot.position.z;
      moveBody(world, bot, wishX, wishZ, dt, speed, false);
      const moved = Math.hypot(bot.position.x - beforeX, bot.position.z - beforeZ);
      if (moved < 0.004 && (wishX || wishZ)) {
        bot.stuck += dt;
        if (bot.stuck > 1.2) { bot.pathIndex += 1; bot.stuck = 0; }
      } else bot.stuck = Math.max(0, bot.stuck - dt);

      // visual
      const model = bot.model;
      model.group.position.copy(bot.position);
      model.group.rotation.y = bot.yaw;
      model.group.rotation.x = 0;
      const walking = moved > 0.006;
      if (walking) {
        const swing = Math.sin(now * 10 + bot.index) * 0.5;
        model.legL.rotation.x = swing; model.legR.rotation.x = -swing;
        model.armL.rotation.x = -swing * 0.7;
      } else {
        model.legL.rotation.x *= 0.8; model.legR.rotation.x *= 0.8; model.armL.rotation.x *= 0.8;
      }
      model.tag.visible = Math.hypot(bot.position.x - ctx.camera.x, bot.position.z - ctx.camera.z) < 26;
    }
  }

  function countAlive(team) {
    let n = 0;
    for (const bot of bots) if (bot.team === team && bot.alive) n += 1;
    return n;
  }

  function nearestOf(team, point, except) {
    let best = null, bestD = Infinity;
    for (const bot of bots) {
      if (bot.team !== team || !bot.alive || bot === except) continue;
      const d = Math.hypot(bot.position.x - point.x, bot.position.z - point.z);
      if (d < bestD) { bestD = d; best = bot; }
    }
    return best;
  }

  function resetForRound(round, rng, plan) { reset(round, rng, plan); }

  return {
    bots, all, reset: resetForRound, step, damage, alert, rotateDefenders, setCarrier,
    countAlive, nearestOf, sendTo: assignPath,
  };
}
