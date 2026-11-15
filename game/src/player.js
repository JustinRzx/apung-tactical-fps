// Player body: acceleration/friction, crouch, jump, AABB capsule-vs-box collision with stair
// step-up. Bots reuse the same solver, so both obey the same authored colliders.
import * as THREE from 'three';

export const RADIUS = 0.34;
export const STAND_HEIGHT = 1.72;
export const CROUCH_HEIGHT = 1.12;
export const STAND_EYE = 1.6;
export const CROUCH_EYE = 1.04;
const WALK_SPEED = 5.1;
const CROUCH_SPEED = 2.5;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 8;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;
const STEP_UP = 0.42;

export function bodyOverlaps(colliders, x, y, z, height, lift = 0, radius = RADIUS) {
  const minX = x - radius, maxX = x + radius;
  const minY = y + lift, maxY = y + height - lift;
  const minZ = z - radius, maxZ = z + radius;
  for (const box of colliders) {
    if (minX < box.max.x && maxX > box.min.x && minY < box.max.y && maxY > box.min.y && minZ < box.max.z && maxZ > box.min.z) return box;
  }
  return null;
}

function moveAxis(world, body, axis, delta) {
  if (delta === 0) return;
  const px = body.position.x, py = body.position.y, pz = body.position.z;
  const nx = axis === 'x' ? px + delta : px;
  const nz = axis === 'z' ? pz + delta : pz;
  if (!bodyOverlaps(world.colliders, nx, py, nz, body.height, 0.04)) {
    body.position.x = nx;
    body.position.z = nz;
    return;
  }
  if (body.onGround) {
    for (let up = STEP_UP; up <= STEP_UP * 2; up += STEP_UP) {
      if (!bodyOverlaps(world.colliders, nx, py + up, nz, body.height, 0.05) && !bodyOverlaps(world.colliders, nx, py + up, nz, body.height, 0)) {
        body.position.x = nx;
        body.position.z = nz;
        body.position.y = py + up;
        body.velocity.y = Math.max(0, body.velocity.y);
        return;
      }
    }
  }
  if (axis === 'x') body.velocity.x = 0;
  else body.velocity.z = 0;
}

export function moveBody(world, body, wishX, wishZ, dt, speed, jump = false) {
  const len = Math.hypot(wishX, wishZ);
  const blend = Math.min(1, (body.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
  const targetX = len > 0.0001 ? (wishX / len) * speed : 0;
  const targetZ = len > 0.0001 ? (wishZ / len) * speed : 0;
  body.velocity.x += (targetX - body.velocity.x) * blend;
  body.velocity.z += (targetZ - body.velocity.z) * blend;
  if (body.onGround && len < 0.02) {
    const damp = Math.max(0, 1 - FRICTION * dt);
    body.velocity.x *= damp;
    body.velocity.z *= damp;
  }
  if (jump && body.onGround) {
    body.velocity.y = JUMP_SPEED;
    body.onGround = false;
  }
  body.velocity.y = Math.max(-30, body.velocity.y - GRAVITY * dt);

  moveAxis(world, body, 'x', body.velocity.x * dt);
  moveAxis(world, body, 'z', body.velocity.z * dt);

  body.position.y += body.velocity.y * dt;
  body.onGround = false;
  let floor = -Infinity;
  let ceiling = Infinity;
  for (const box of world.colliders) {
    if (body.position.x - RADIUS < box.max.x && body.position.x + RADIUS > box.min.x &&
        body.position.z - RADIUS < box.max.z && body.position.z + RADIUS > box.min.z &&
        body.position.y < box.max.y && body.position.y + body.height > box.min.y) {
      if (box.max.y > floor) floor = box.max.y;
      if (box.min.y < ceiling) ceiling = box.min.y;
    }
  }
  if (floor > -Infinity) {
    if (body.velocity.y <= 0) {
      body.position.y = floor;
      body.velocity.y = 0;
      body.onGround = true;
    } else if (ceiling < Infinity) {
      body.position.y = ceiling - body.height;
      body.velocity.y = 0;
    }
  }
  if (body.position.y < -3) {
    body.position.y = -3;
    body.velocity.y = 0;
  }
}

export function createPlayer(world) {
  const state = {
    position: new THREE.Vector3(0, 0, 29),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    height: STAND_HEIGHT,
    health: 100,
    armour: 0,
    alive: true,
    kills: 0,
    deaths: 0,
    money: 800,
  };

  function look(dx, dy, sensitivity = 0.0022) {
    state.yaw -= dx * sensitivity;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch = Math.min(1.45, state.pitch + pitchKick);
    state.yaw += yawKick;
  }

  function step(dt, input) {
    const crouching = !!input.crouch;
    if (crouching && !state.crouching) { state.crouching = true; state.height = CROUCH_HEIGHT; }
    else if (!crouching && state.crouching && !bodyOverlaps(world.colliders, state.position.x, state.position.y, state.position.z, STAND_HEIGHT, 0.02)) {
      state.crouching = false; state.height = STAND_HEIGHT;
    }
    const eyeTarget = state.crouching ? CROUCH_EYE : STAND_EYE;
    state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 12);

    const forward = (input.forward ? 1 : 0) - (input.back ? 1 : 0);
    const strafe = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    let wishX = 0, wishZ = 0;
    if (forward || strafe) {
      const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
      wishX = -sin * forward + cos * strafe;
      wishZ = -cos * forward - sin * strafe;
    }
    const speed = state.crouching ? CROUCH_SPEED : WALK_SPEED;
    moveBody(world, state, wishX, wishZ, dt, speed, !!input.jump && !state.crouching);
  }

  function damage(amount) {
    if (!state.alive || amount <= 0) return { died: false, dealt: 0 };
    let health = amount;
    if (state.armour > 0) {
      const soaked = Math.min(state.armour, health * 0.5);
      state.armour = Math.max(0, state.armour - soaked);
      health *= 0.58;
    }
    state.health = Math.max(0, state.health - health);
    if (state.health <= 0) {
      state.alive = false;
      state.deaths += 1;
      return { died: true, dealt: health };
    }
    return { died: false, dealt: health };
  }

  function respawn(spawn, yaw) {
    state.position.set(spawn.x, spawn.y, spawn.z);
    state.velocity.set(0, 0, 0);
    state.yaw = yaw;
    state.pitch = 0;
    state.health = 100;
    state.armour = 0;
    state.alive = true;
    state.crouching = false;
    state.height = STAND_HEIGHT;
    state.eye = STAND_EYE;
    state.onGround = true;
  }

  function eye(out = new THREE.Vector3()) {
    return out.set(state.position.x, state.position.y + state.eye, state.position.z);
  }

  function groundSpeed() {
    return Math.hypot(state.velocity.x, state.velocity.z);
  }

  return { state, step, look, recoil, damage, respawn, eye, groundSpeed };
}
