// Four original APUNG weapons. This module owns their numbers, the view model, recoil bloom and
// the reload timer; main.js owns the ray, the hit test and the damage application.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'Kujang P9', role: 'PISTOL', price: 0, mag: 12, reserve: 36,
    fireGap: 0.16, reload: 1.35, damage: 27, auto: false, range: 42,
    spreadStill: 0.0042, spreadMove: 0.035, bloom: 0.0075, kickPitch: 0.012, kickYaw: 0.0035,
    falloff: [[0, 1], [16, 0.86], [30, 0.7], [42, 0.55]],
  },
  smg: {
    id: 'smg', name: 'Cicak', role: 'SMG', price: 1500, mag: 24, reserve: 96,
    fireGap: 0.082, reload: 1.95, damage: 23, auto: true, range: 36,
    spreadStill: 0.0068, spreadMove: 0.05, bloom: 0.0062, kickPitch: 0.0105, kickYaw: 0.0042,
    falloff: [[0, 1], [14, 0.85], [26, 0.66], [36, 0.5]],
  },
  rifle: {
    id: 'rifle', name: 'Badak AR', role: 'RIFLE', price: 2700, mag: 30, reserve: 90,
    fireGap: 0.1, reload: 2.15, damage: 34, auto: true, range: 55,
    spreadStill: 0.0034, spreadMove: 0.06, bloom: 0.0085, kickPitch: 0.014, kickYaw: 0.0045,
    falloff: [[0, 1], [20, 0.9], [36, 0.76], [55, 0.58]],
  },
  sniper: {
    id: 'sniper', name: 'Elang DMR', role: 'SNIPER', price: 4750, mag: 5, reserve: 15,
    fireGap: 0.62, reload: 2.9, damage: 82, auto: false, range: 80,
    spreadStill: 0.0014, spreadMove: 0.11, bloom: 0.02, kickPitch: 0.04, kickYaw: 0.006,
    falloff: [[0, 1], [40, 0.92], [80, 0.78]],
  },
};

export const SLOTS = ['pistol', 'smg', 'rifle', 'sniper'];

export function damageAt(weapon, distance) {
  const table = weapon.falloff;
  let factor = table[table.length - 1][1];
  for (let i = 0; i < table.length - 1; i += 1) {
    const [d0, f0] = table[i];
    const [d1, f1] = table[i + 1];
    if (distance <= d1) {
      const t = Math.max(0, (distance - d0) / (d1 - d0));
      factor = f0 + (f1 - f0) * t;
      break;
    }
  }
  return weapon.damage * factor;
}

function basicMaterial(color, roughness = 0.55, metalness = 0.35) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness, metalness });
}

export function createWeapon(camera) {
  const dark = basicMaterial(PALETTE.woodDark, 0.75, 0.25);
  const steel = basicMaterial('#3c4650', 0.4, 0.65);
  const light = basicMaterial(PALETTE.woodLight, 0.65, 0.15);
  const teal = basicMaterial(PALETTE.tealDeep, 0.5, 0.3);

  const root = new THREE.Group();
  camera.add(root);

  const models = {};
  function makeModel(id) {
    const g = new THREE.Group();
    if (id === 'pistol') {
      const slide = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.3), steel); slide.position.set(0, 0.02, -0.12);
      const grip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.16, 0.09), dark); grip.position.set(0, -0.09, 0.01); grip.rotation.x = 0.18;
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.04), teal); sight.position.set(0, 0.08, -0.24);
      g.add(slide, grip, sight);
    } else if (id === 'smg') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 0.36), steel); body.position.set(0, 0.01, -0.14);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.24), dark); barrel.position.set(0, 0.03, -0.4);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.18, 0.07), teal); mag.position.set(0, -0.12, -0.12); mag.rotation.x = -0.12;
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.07, 0.2), dark); stock.position.set(0, -0.01, 0.12);
      g.add(body, barrel, mag, stock);
    } else if (id === 'rifle') {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.5), steel); body.position.set(0, 0.01, -0.22);
      const barrel = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.045, 0.34), dark); barrel.position.set(0, 0.035, -0.6);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.2, 0.1), teal); mag.position.set(0, -0.13, -0.16); mag.rotation.x = -0.16;
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.24), light); stock.position.set(0, -0.02, 0.13);
      const sight = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.04, 0.16), dark); sight.position.set(0, 0.1, -0.18);
      g.add(body, barrel, mag, stock, sight);
    } else {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.6), light); body.position.set(0, 0.01, -0.26);
      const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.5, 8), dark); barrel.rotation.x = Math.PI / 2; barrel.position.set(0, 0.04, -0.66);
      const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.24, 10), steel); scope.rotation.x = Math.PI / 2; scope.position.set(0, 0.14, -0.2);
      const stock = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.1, 0.28), light); stock.position.set(0, -0.02, 0.16);
      const mag = new THREE.Mesh(new THREE.BoxGeometry(0.055, 0.12, 0.09), teal); mag.position.set(0, -0.11, -0.14);
      g.add(body, barrel, scope, stock, mag);
    }
    g.position.set(0.26, -0.235, -0.52);
    g.scale.setScalar(0.62);
    g.visible = false;
    root.add(g);
    return g;
  }
  for (const id of SLOTS) models[id] = makeModel(id);

  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.lantern), transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.27, -0.2, -0.99);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.lantern), 0, 7, 2);
  flashLight.position.set(0.26, -0.19, -0.78);
  camera.add(flashLight);

  const state = {
    id: 'pistol',
    mag: WEAPONS.pistol.mag,
    reserve: WEAPONS.pistol.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    bloom: 0,
  };

  function def() { return WEAPONS[state.id]; }

  function equip(id, full = true) {
    if (!WEAPONS[id]) return;
    state.id = id;
    for (const key of SLOTS) models[key].visible = key === id;
    if (full) { state.mag = WEAPONS[id].mag; state.reserve = WEAPONS[id].reserve; }
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.bloom = 0;
  }
  equip('pistol');

  // Gameplay timers advance on the fixed simulation step, never in the render loop.
  function advance(dt) {
    const d = def();
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.bloom = Math.max(0, state.bloom - dt * (d.auto ? 0.055 : 0.08));
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      if (state.reloadLeft === 0) {
        const need = d.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  // Visual-only: muzzle flash fade, recoil kick and weapon bob.
  function step(dt, speed = 0) {
    const d = def();
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    const model = models[state.id];
    model.position.z = -0.52 + state.kick;
    model.position.x = 0.26 + Math.sin(speed * 1.4) * 0.006;
    model.position.y = -0.235 + Math.abs(Math.cos(speed * 1.4)) * 0.004;
    model.rotation.x = state.kick * 2.1;
    model.rotation.z = state.kick * 0.7;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 26;
    flashLight.intensity = state.flash > 0 ? 16 : 0;
    if (state.reloadLeft > 0) model.rotation.x = -0.6 * Math.min(1, (d.reload - state.reloadLeft) * 2.4);
  }

  function ready() {
    return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
  }

  function consume() {
    if (state.mag <= 0) return false;
    state.mag -= 1;
    return true;
  }

  function pullTrigger() {
    const d = def();
    state.cooldown = d.fireGap;
    state.flash = 0.055;
    state.kick = 0.05;
    state.bloom = Math.min(0.09, state.bloom + d.bloom);
  }

  function reload() {
    const d = def();
    if (state.reloadLeft > 0 || state.mag >= d.mag || state.reserve === 0) return;
    state.reloadLeft = d.reload;
  }

  function spread(speed, crouching = false) {
    const d = def();
    const move = Math.min(1, speed / 5.1);
    return d.spreadStill + move * d.spreadMove + state.bloom * (crouching ? 0.6 : 1);
  }

  function refill() {
    const d = def();
    state.mag = d.mag;
    state.reserve = d.reserve;
    state.cooldown = 0;
    state.reloadLeft = 0;
    state.flash = 0;
    state.kick = 0;
    state.bloom = 0;
  }

  return { state, def, equip, step, advance, ready, consume, pullTrigger, reload, spread, refill, models };
}
