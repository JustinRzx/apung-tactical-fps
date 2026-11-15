// APUNG's arena: a fishing stilt-village over a lagoon at dusk. Every solid is an authored AABB;
// visuals never collide. Also owns the lane waypoint graph, sites, callout zones and ray helpers.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { makeRng } from './rng.js';

const TEX = {};

function makeTexture(size, draw, rx = 1, ry = 1) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(rx, ry);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

function noise(ctx, size, rng, count, alpha, colors) {
  for (let i = 0; i < count; i += 1) {
    ctx.globalAlpha = alpha * rng.next();
    ctx.fillStyle = colors[Math.floor(rng.next() * colors.length)];
    ctx.fillRect(rng.next() * size, rng.next() * size, 1 + rng.next() * 3, 1 + rng.next() * 3);
  }
  ctx.globalAlpha = 1;
}

function buildTextures() {
  const r = makeRng(0x2f6a11);
  TEX.wood = makeTexture(256, (ctx, s) => {
    ctx.fillStyle = PALETTE.wood; ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 32) {
      ctx.fillStyle = y % 64 === 0 ? PALETTE.woodDark : PALETTE.woodLight;
      ctx.globalAlpha = 0.28; ctx.fillRect(0, y, s, 2); ctx.globalAlpha = 1;
      for (let i = 0; i < 7; i += 1) {
        ctx.strokeStyle = 'rgba(40,26,14,0.18)'; ctx.lineWidth = 1;
        ctx.beginPath();
        const yy = y + 6 + r.next() * 20;
        ctx.moveTo(0, yy); ctx.bezierCurveTo(s * .3, yy + r.next() * 4 - 2, s * .7, yy - r.next() * 4, s, yy);
        ctx.stroke();
      }
    }
    noise(ctx, s, r, 500, 0.12, ['#2e1f12', '#8d6742', '#5a3d26']);
  }, 5, 5);
  TEX.plaster = makeTexture(256, (ctx, s) => {
    ctx.fillStyle = PALETTE.plaster; ctx.fillRect(0, 0, s, s);
    noise(ctx, s, r, 1400, 0.14, ['#b7a486', '#e6d8bd', '#9a866c']);
    ctx.strokeStyle = 'rgba(90,74,56,0.25)';
    for (let i = 0; i < 5; i += 1) {
      ctx.beginPath(); const x = r.next() * s, y = r.next() * s;
      ctx.moveTo(x, y); ctx.lineTo(x + r.next() * 40 - 20, y + 10 + r.next() * 30); ctx.stroke();
    }
  }, 3, 2);
  TEX.crate = makeTexture(256, (ctx, s) => {
    ctx.fillStyle = PALETTE.crate; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = '#4a3320'; ctx.lineWidth = 14; ctx.strokeRect(7, 7, s - 14, s - 14);
    ctx.lineWidth = 10; ctx.beginPath(); ctx.moveTo(14, 14); ctx.lineTo(s - 14, s - 14); ctx.moveTo(s - 14, 14); ctx.lineTo(14, s - 14); ctx.stroke();
    noise(ctx, s, r, 600, 0.16, ['#5e4228', '#a2743f', '#3d2a19']);
  }, 1, 1);
  TEX.roof = makeTexture(256, (ctx, s) => {
    ctx.fillStyle = PALETTE.roof; ctx.fillRect(0, 0, s, s);
    for (let y = 0; y < s; y += 24) {
      ctx.fillStyle = 'rgba(15,14,20,0.5)'; ctx.fillRect(0, y, s, 3);
      for (let x = (y / 24) % 2 ? 12 : 0; x < s; x += 24) { ctx.fillStyle = 'rgba(10,9,14,0.35)'; ctx.fillRect(x, y + 3, 2, 21); }
    }
    noise(ctx, s, r, 400, 0.1, ['#2a2731', '#585363']);
  }, 4, 4);
  TEX.paper = makeTexture(128, (ctx, s) => {
    const g = ctx.createRadialGradient(s / 2, s / 2, 4, s / 2, s / 2, s / 2);
    g.addColorStop(0, '#fff6dc'); g.addColorStop(0.5, '#ffcf86'); g.addColorStop(1, '#c96d2a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
    ctx.strokeStyle = 'rgba(120,60,20,.35)'; ctx.lineWidth = 2; ctx.strokeRect(8, 8, s - 16, s - 16);
  });
  TEX.water = makeTexture(256, (ctx, s) => {
    ctx.fillStyle = PALETTE.water; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 90; i += 1) {
      ctx.strokeStyle = i % 3 === 0 ? 'rgba(127,183,180,0.35)' : 'rgba(18,36,44,0.5)';
      ctx.lineWidth = 1 + r.next() * 2;
      ctx.beginPath();
      const y = r.next() * s, x = r.next() * s, w = 8 + r.next() * 40;
      ctx.moveTo(x, y); ctx.quadraticCurveTo(x + w / 2, y + r.next() * 6 - 3, x + w, y); ctx.stroke();
    }
  }, 10, 10);
}

function makeMesh(w, h, d, x, y, z, material) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export function createWorld(scene) {
  buildTextures();
  const group = new THREE.Group();
  scene.add(group);
  const colliders = [];
  const meshes = [];
  const lanterns = [];
  const zones = [];
  const rng = makeRng(0x1a9e77);

  const mat = {
    wood: new THREE.MeshStandardMaterial({ map: TEX.wood, roughness: 0.86, metalness: 0.02 }),
    woodDark: new THREE.MeshStandardMaterial({ color: PALETTE.woodDark, roughness: 0.9 }),
    woodLight: new THREE.MeshStandardMaterial({ color: PALETTE.woodLight, roughness: 0.8 }),
    plaster: new THREE.MeshStandardMaterial({ map: TEX.plaster, roughness: 0.95 }),
    plasterDark: new THREE.MeshStandardMaterial({ color: PALETTE.plasterDark, roughness: 0.95 }),
    roof: new THREE.MeshStandardMaterial({ map: TEX.roof, roughness: 0.85 }),
    crate: new THREE.MeshStandardMaterial({ map: TEX.crate, roughness: 0.9 }),
    stone: new THREE.MeshStandardMaterial({ color: PALETTE.stone, roughness: 0.95 }),
    teal: new THREE.MeshStandardMaterial({ color: PALETTE.teal, emissive: PALETTE.tealDeep, emissiveIntensity: 0.5, roughness: 0.5 }),
    amber: new THREE.MeshStandardMaterial({ color: PALETTE.amber, emissive: PALETTE.amberDeep, emissiveIntensity: 0.6, roughness: 0.5 }),
    lantern: new THREE.MeshStandardMaterial({ map: TEX.paper, emissive: PALETTE.lantern, emissiveIntensity: 1.4, roughness: 0.6 }),
    window: new THREE.MeshBasicMaterial({ color: '#ffd9a0' }),
    dark: new THREE.MeshStandardMaterial({ color: PALETTE.night, roughness: 0.95 }),
  };

  function addBox(w, h, d, x, y, z, material, solid = true) {
    const mesh = makeMesh(w, h, d, x, y, z, material);
    group.add(mesh);
    meshes.push(mesh);
    if (solid) {
      colliders.push(new THREE.Box3(new THREE.Vector3(x - w / 2, y - h / 2, z - d / 2), new THREE.Vector3(x + w / 2, y + h / 2, z + d / 2)));
    }
    return mesh;
  }

  // ---------------------------------------------------------------- decks (top surface y = 0)
  addBox(20, 0.7, 8, 0, -0.35, 28, mat.wood);            // south spawn
  addBox(20, 0.7, 8, 0, -0.35, -28, mat.wood);           // north spawn
  addBox(20, 0.7, 16, 0, -0.35, 2, mat.wood);            // market deck
  addBox(8, 0.7, 14, 0, -0.35, 17, mat.wood);            // south connector
  addBox(8, 0.7, 18, 0, -0.35, -15, mat.wood);           // north connector
  addBox(8, 0.7, 14, 20, -0.35, 17, mat.wood);           // east walkway south
  addBox(8, 0.7, 16, 20, -0.35, 2, mat.wood);            // east walkway mid
  addBox(20, 0.7, 20, 26, -0.35, -10, mat.wood);         // A: Dermaga Ikan
  addBox(20, 0.7, 4, 12, -0.35, -22, mat.wood);          // east north connector
  addBox(8, 0.7, 14, -20, -0.35, 17, mat.wood);          // west walkway south
  addBox(8, 0.7, 16, -20, -0.35, 2, mat.wood);           // west walkway mid
  addBox(20, 0.7, 20, -26, -0.35, -10, mat.wood);        // B: Pura Lampion
  addBox(20, 0.7, 4, -12, -0.35, -22, mat.wood);         // west north connector
  addBox(6, 0.7, 4, 13, -0.35, 0, mat.wood);             // market → A link
  addBox(6, 0.7, 4, -13, -0.35, 0, mat.wood);            // market → B link

  // stilts under the decks
  for (let x = -32; x <= 32; x += 8) {
    for (let z = -30; z <= 30; z += 8) {
      if ((Math.abs(x) <= 10 && Math.abs(z) <= 10) || (Math.abs(x) > 14 && Math.abs(z) <= 20) || (Math.abs(z) > 24 && Math.abs(x) <= 10)) {
        const h = 1.6;
        addBox(0.28, h, 0.28, x + rng.range(-0.2, 0.2), -0.7 - h / 2, z + rng.range(-0.2, 0.2), mat.woodDark, false);
      }
    }
  }

  // ---------------------------------------------------------------- market stalls, roof and stairs
  // stall houses under the market roof (leave central lane open)
  addBox(0.5, 3.0, 0.5, -7, 1.5, -4, mat.woodDark);
  addBox(0.5, 3.0, 0.5, 7, 1.5, -4, mat.woodDark);
  addBox(0.5, 3.0, 0.5, -7, 1.5, 7, mat.woodDark);
  addBox(0.5, 3.0, 0.5, 7, 1.5, 7, mat.woodDark);
  addBox(13, 0.4, 7, 0, 3.0, 1.5, mat.roof);             // market roof
  addBox(12, 0.35, 3.4, 0, 2.95, 6.4, mat.roof);         // north awning edge
  // north stair (x=5) rising to roof
  for (let i = 0; i < 8; i += 1) {
    const top = (i + 1) * 0.375;
    addBox(2.6, 0.55, 0.9, 5, top - 0.275, 8.5 - i * 0.8, mat.woodLight);
  }
  // south stair (x=-5) rising to roof
  for (let i = 0; i < 8; i += 1) {
    const top = (i + 1) * 0.375;
    addBox(2.6, 0.55, 0.9, -5, top - 0.275, -5.5 + i * 0.8, mat.woodLight);
  }
  addBox(14, 0.9, 0.16, 0, 3.45, -2.0, mat.woodDark);    // roof north railing
  addBox(0.16, 0.9, 8, -6.9, 3.45, 1.5, mat.woodDark);   // roof west railing
  addBox(0.16, 0.9, 8, 6.9, 3.45, 1.5, mat.woodDark);    // roof east railing

  // A rooftop deck + stairs + railings
  addBox(12, 0.4, 8, 28, 3.0, -12, mat.roof);
  for (let i = 0; i < 8; i += 1) {
    const top = (i + 1) * 0.375;
    addBox(2.4, 0.55, 0.9, 22, top - 0.275, -1.5 - i * 0.8, mat.woodLight);
  }
  addBox(12, 0.9, 0.16, 28, 3.45, -16, mat.woodDark);
  addBox(0.16, 0.9, 8, 22.1, 3.45, -12, mat.woodDark);

  // B rooftop deck + stairs + railings
  addBox(12, 0.4, 8, -28, 3.0, -12, mat.roof);
  for (let i = 0; i < 8; i += 1) {
    const top = (i + 1) * 0.375;
    addBox(2.4, 0.55, 0.9, -22, top - 0.275, -1.5 - i * 0.8, mat.woodLight);
  }
  addBox(12, 0.9, 0.16, -28, 3.45, -16, mat.woodDark);
  addBox(0.16, 0.9, 8, -22.1, 3.45, -12, mat.woodDark);

  // ---------------------------------------------------------------- fish-market pier (site A)
  addBox(7, 0.7, 3.2, 23, 0.35, -17, mat.plaster);       // stall hut
  addBox(7.4, 0.25, 3.6, 23, 0.82, -17, mat.roof);
  addBox(0.35, 2.0, 0.35, 26, 1.0, -4.5, mat.woodDark);  // bollards
  addBox(0.35, 2.0, 0.35, 30, 1.0, -4.5, mat.woodDark);
  addBox(3.6, 0.9, 1.2, 30, 0.45, -18, mat.crate);       // fish crates
  addBox(2.2, 0.9, 1.2, 21, 0.45, -14, mat.crate);
  addBox(1.4, 1.2, 1.4, 24, 0.6, -6.5, mat.crate);
  addBox(1.2, 1.2, 1.2, 32, 0.6, -8, mat.crate);
  addBox(2.2, 0.55, 1.4, 32, 0.28, -12, mat.plasterDark);
  addBox(2, 0.3, 1, 26, 0.85, -17.2, mat.window, false); // stall lamp panel
  addBox(1.8, 0.12, 0.7, 23, 1.9, -14, mat.window, false);

  // ---------------------------------------------------------------- lantern shrine (site B)
  addBox(10, 0.35, 10, -26, 0.175, -10, mat.stone);      // shrine platform
  addBox(0.6, 2.6, 0.6, -29.5, 1.3, -12.5, mat.woodDark);
  addBox(0.6, 2.6, 0.6, -22.5, 1.3, -12.5, mat.woodDark);
  addBox(0.6, 2.6, 0.6, -29.5, 1.3, -7.5, mat.woodDark);
  addBox(0.6, 2.6, 0.6, -22.5, 1.3, -7.5, mat.woodDark);
  addBox(9, 0.4, 7.5, -26, 2.8, -10, mat.roof);          // shrine roof
  addBox(7, 0.4, 5.5, -26, 3.15, -10, mat.roof);
  addBox(2.4, 1.3, 0.7, -26, 0.65, -8.3, mat.plaster);   // altar
  addBox(1.2, 0.9, 0.5, -24, 0.45, -11.2, mat.plasterDark);
  addBox(4, 0.7, 1.2, -31.5, 0.35, -15, mat.crate);
  addBox(1.6, 1.2, 1.6, -21, 0.6, -15, mat.crate);
  addBox(1.5, 1.2, 1.5, -31, 0.6, -5, mat.crate);
  addBox(2.0, 0.3, 0.8, -26, 1.6, -8.4, mat.window, false);
  // shrine steps / thresholds
  addBox(8, 0.35, 1.0, -26, 0.175, -5.6, mat.stone);

  // ---------------------------------------------------------------- cover around lanes
  const cover = [
    [1.4, 1.2, 1.4, 4.5, 0.6, -2.5], [-1.4, 1.2, 1.4, -4.5, 0.6, -2.5],
    [2.4, 1.0, 1.2, 2.6, 0.5, 8.0], [2.4, 1.0, 1.2, -2.6, 0.5, 8.0],
    [1.4, 1.1, 1.4, 6.5, 0.55, 16.5], [1.4, 1.1, 1.4, -6.5, 0.55, 16.5],
    [1.4, 1.1, 1.4, 6.5, 0.55, -16.5], [1.4, 1.1, 1.4, -6.5, 0.55, -16.5],
    [1.6, 1.1, 1.6, 16.5, 0.55, 18.0], [1.6, 1.1, 1.6, 23.0, 0.55, 8.0],
    [1.6, 1.1, 1.6, 16.5, 0.55, -18.0], [1.6, 1.1, 1.6, -16.5, 0.55, 18.0],
    [1.6, 1.1, 1.6, -23.0, 0.55, 8.0], [1.6, 1.1, 1.6, -16.5, 0.55, -18.0],
    [1.2, 1.2, 1.2, 11.5, 0.6, 2.5], [1.2, 1.2, 1.2, -11.5, 0.6, 2.5],
    [1.2, 0.9, 1.2, 13, 0.45, -2.5], [1.2, 0.9, 1.2, -13, 0.45, -2.5],
    [1.0, 1.0, 1.0, 0, 0.5, 27.0], [1.6, 0.9, 1.0, 8, 0.45, -27.5], [1.6, 0.9, 1.0, -8, 0.45, -27.5],
  ];
  for (const [w, h, d, x, y, z] of cover) addBox(w, h, d, x, y, z, mat.crate);

  // rooftop cover
  addBox(1.4, 1.2, 1.0, 1.5, 3.6, 0.5, mat.crate);
  addBox(1.2, 1.0, 1.2, -1.5, 3.5, 2.5, mat.crate);
  addBox(1.4, 1.1, 1.0, 27, 3.55, -12, mat.crate);
  addBox(1.2, 1.0, 1.2, 30, 3.5, -14, mat.crate);
  addBox(1.4, 1.1, 1.0, -27, 3.55, -12, mat.crate);
  addBox(1.2, 1.0, 1.2, -30, 3.5, -14, mat.crate);

  // ---------------------------------------------------------------- site markers & lanterns
  const sites = [
    { id: 'A', name: 'Dermaga Ikan', short: 'Dermaga', x: 26, z: -9, radius: 4.2, color: PALETTE.teal },
    { id: 'B', name: 'Pura Lampion', short: 'Pura', x: -26, z: -9, radius: 4.2, color: PALETTE.amber },
  ];
  for (const site of sites) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(site.radius - 0.35, site.radius, 40), new THREE.MeshBasicMaterial({ color: site.color, transparent: true, opacity: 0.45, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(site.x, site.id === 'B' ? 0.39 : 0.04, site.z);
    group.add(ring);
    site.ring = ring;
    const sign = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeSign(site.id, site.color), transparent: true, depthWrite: false }));
    sign.position.set(site.x, 4.2, site.z);
    sign.scale.set(2.4, 2.4, 1);
    group.add(sign);
    site.sign = sign;
  }

  function makeSign(letter, color) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = 'rgba(10,14,20,0.65)';
    ctx.beginPath(); ctx.arc(64, 64, 50, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 6; ctx.stroke();
    ctx.fillStyle = color; ctx.font = 'bold 74px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(letter, 64, 68);
    const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  function addLantern(x, y, z, pole = true) {
    if (pole) addBox(0.16, y, 0.16, x, y / 2, z, mat.woodDark);
    const bulb = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.55, 0.42), mat.lantern);
    bulb.position.set(x, y + 0.2, z);
    group.add(bulb);
    const light = new THREE.PointLight(new THREE.Color(PALETTE.lantern), 26, 20, 2);
    light.position.set(x, y + 0.25, z);
    group.add(light);
    lanterns.push({ mesh: bulb, light, base: 8.5 + rng.range(0, 1.5), phase: rng.range(0, 6.28) });
  }
  // six lanterns: two per site, one market, one mid
  addLantern(23, 2.6, -2.5); addLantern(31, 2.6, -15);
  addLantern(-23, 2.6, -2.5); addLantern(-31, 2.6, -15);
  addLantern(0, 3.6, 4.5, false);
  addLantern(13, 2.4, 0, true);
  addLantern(-28.5, 2.2, -9, false);
  addLantern(-23.5, 2.2, -11, false);

  // extra emissive window boxes on stalls and roofs (no lights)
  for (const [x, y, z, w, h] of [[-7, 2.2, -4.2, 0.8, 0.6], [7, 2.2, -4.2, 0.8, 0.6], [23, 1.4, -15.5, 1.4, 0.7], [-23, 1.4, -15.5, 1.1, 0.7]]) {
    const win = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat.window);
    win.position.set(x, y, z); win.rotation.y = z > 0 ? Math.PI : 0; group.add(win);
  }

  // ---------------------------------------------------------------- water, boats, mountains, sky
  const waterGeo = new THREE.PlaneGeometry(320, 320, 1, 1);
  const waterMat = new THREE.MeshStandardMaterial({ map: TEX.water, color: '#7fd6cf', roughness: 0.32, metalness: 0.45, transparent: true, opacity: 0.94 });
  waterMat.map.repeat.set(14, 14);
  const water = new THREE.Mesh(waterGeo, waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = -1.35;
  water.receiveShadow = true;
  group.add(water);
  TEX.water.offset.set(0.1, 0.05);

  function addBoat(x, z, rot, scale) {
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(new THREE.BoxGeometry(4.2 * scale, 0.55, 1.5 * scale), mat.woodDark);
    hull.position.y = 0.1;
    const rim = new THREE.Mesh(new THREE.BoxGeometry(4.4 * scale, 0.16, 1.7 * scale), mat.woodLight);
    rim.position.y = 0.42;
    const mast = new THREE.Mesh(new THREE.BoxGeometry(0.12, 3.2 * scale, 0.12), mat.woodDark);
    mast.position.set(0.4 * scale, 1.7 * scale, 0);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16 * scale, 8, 6), mat.lantern);
    lamp.position.set(0.4 * scale, 3.1 * scale, 0);
    const glow = new THREE.PointLight(new THREE.Color(PALETTE.lantern), 3.2, 9, 2);
    glow.position.set(0.4 * scale, 3.1 * scale, 0);
    boat.add(hull, rim, mast, lamp, glow);
    boat.position.set(x, -1.18, z);
    boat.rotation.y = rot;
    group.add(boat);
  }
  addBoat(13, 13, 0.5, 1);
  addBoat(-13, 13, -0.6, 0.9);
  addBoat(31, 8, 1.2, 1.1);
  addBoat(-30, 9, -1.0, 1);
  addBoat(8, -13, 0.2, 0.8);
  addBoat(-9, -14, 2.9, 0.95);

  // distant mountains
  const mountainMat = new THREE.MeshStandardMaterial({ color: '#32394f', roughness: 1, flatShading: true });
  for (let i = 0; i < 12; i += 1) {
    const angle = (i / 12) * Math.PI * 2 + 0.2;
    const radius = 130 + rng.range(0, 50);
    const height = 26 + rng.range(0, 34);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(24 + rng.range(0, 22), height, 5), mountainMat);
    cone.position.set(Math.cos(angle) * radius, height / 2 - 2, Math.sin(angle) * radius);
    cone.rotation.y = rng.range(0, 6.28);
    group.add(cone);
  }

  // sky gradient (full-screen background texture)
  const skyCanvas = document.createElement('canvas');
  skyCanvas.width = 4; skyCanvas.height = 256;
  const skyCtx = skyCanvas.getContext('2d');
  const grad = skyCtx.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, PALETTE.skyTop); grad.addColorStop(0.46, PALETTE.skyMid);
  grad.addColorStop(0.7, PALETTE.skyLow); grad.addColorStop(1, PALETTE.night);
  skyCtx.fillStyle = grad; skyCtx.fillRect(0, 0, 4, 256);
  const skyTex = new THREE.CanvasTexture(skyCanvas); skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;
  scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 34, 135);

  // lighting: low warm dusk sun, cool fill, hemisphere, plus lantern points above
  const hemi = new THREE.HemisphereLight(new THREE.Color('#9ab0c9'), new THREE.Color('#1d2a2c'), 0.85);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(new THREE.Color('#ffbd7d'), 2.0);
  sun.position.set(-38, 22, 34);
  sun.target.position.set(0, 0, -6);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -52; sun.shadow.camera.right = 52;
  sun.shadow.camera.top = 52; sun.shadow.camera.bottom = -52;
  sun.shadow.camera.near = 1; sun.shadow.camera.far = 130;
  sun.shadow.bias = -0.0007;
  scene.add(sun, sun.target);
  const fill = new THREE.DirectionalLight(new THREE.Color('#5a86b8'), 0.45);
  fill.position.set(30, 18, -30);
  scene.add(fill);

  // rain
  const rainCount = 1100;
  const rainGeo = new THREE.BufferGeometry();
  const rainPos = new Float32Array(rainCount * 3);
  const rainVel = new Float32Array(rainCount);
  for (let i = 0; i < rainCount; i += 1) {
    rainPos[i * 3] = rng.range(-55, 55);
    rainPos[i * 3 + 1] = rng.range(0, 24);
    rainPos[i * 3 + 2] = rng.range(-50, 50);
    rainVel[i] = 11 + rng.range(0, 8);
  }
  rainGeo.setAttribute('position', new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.Points(rainGeo, new THREE.PointsMaterial({ color: '#b9cbd4', size: 0.07, transparent: true, opacity: 0.5, depthWrite: false }));
  scene.add(rain);

  // ---------------------------------------------------------------- callout zones
  zones.push({ name: 'Dermaga', x: 24, z: -8, r: 14 }, { name: 'Pura', x: -24, z: -8, r: 14 });
  zones.push({ name: 'Pasar', x: 0, z: 3, r: 10 }, { name: 'Atap', x: 0, z: 1, r: 7, roof: true });
  zones.push({ name: 'Selatan', x: 0, z: 24, r: 9 }, { name: 'Utara', x: 0, z: -23, r: 9 });
  zones.push({ name: 'Lagoon', x: 0, z: 12, r: 6 });

  function zoneAt(x, z, y) {
    if (y > 2.2) return 'Atap';
    let best = 'Lagoon', bestD = Infinity;
    for (const zone of zones) {
      const d = Math.hypot(x - zone.x, z - zone.z);
      if (d < zone.r && d < bestD) { best = zone.name; bestD = d; }
    }
    return best;
  }

  // ---------------------------------------------------------------- nav graph
  const nodes = [];
  const nodeIndex = new Map();
  function node(id, x, y, z) {
    nodeIndex.set(id, nodes.length);
    nodes.push({ id, x, y, z, edges: [] });
  }
  node('s0', 0, 0, 29); node('sW', -5, 0, 28); node('sE', 5, 0, 28);
  node('sMid', 0, 0, 23); node('connS', 0, 0, 17); node('connS2', 0, 0, 13.5); node('mktS', 0, 0, 10); node('mktS2', 0, 0, 5.5);
  node('mktC', 0, 0, 1); node('mktN', 0, 0, -5); node('mktN2', 0, 0, -9); node('connN', 0, 0, -13); node('connN2', 0, 0, -17);
  node('nMid', 0, 0, -21); node('nConn', 0, 0, -26); node('n0', 0, 0, -29);
  node('nW', -5, 0, -28); node('nE', 5, 0, -28);
  // east lane
  node('eS0', 6, 0, 28); node('eS2', 18, 0, 24);
  node('eM0', 20, 0, 18); node('eM0b', 20, 0, 14); node('eM1', 20, 0, 10); node('eM1b', 20, 0, 6); node('eM2', 20, 0, 2);
  node('eM3', 20, 0, -5); node('eA0', 23, 0, -6); node('aC', 26, 0, -9);
  node('aE', 32, 0, -10); node('aS', 24, 0, -15); node('aN', 30, 0, -17);
  node('eN0', 25, 0, -20); node('eN1', 18, 0, -22); node('eN1b', 14.5, 0, -22.5); node('eN2', 11, 0, -23); node('eN3', 5, 0, -23);
  // west lane
  node('wS0', -6, 0, 28); node('wS2', -18, 0, 24);
  node('wM0', -20, 0, 18); node('wM0b', -20, 0, 14); node('wM1', -20, 0, 10); node('wM1b', -20, 0, 6); node('wM2', -20, 0, 2);
  node('wM3', -20, 0, -5); node('wB0', -23, 0, -6); node('bC', -26, 0, -9);
  node('bE', -32, 0, -10); node('bS', -24, 0, -15); node('bN', -30, 0, -17);
  node('wN0', -25, 0, -20); node('wN1', -18, 0, -22); node('wN1b', -14.5, 0, -22.5); node('wN2', -11, 0, -23); node('wN3', -5, 0, -23);
  // mid links
  node('linkE0', 5.5, 0, 1); node('linkE1', 11, 0, 0); node('linkE2', 16.5, 0, 0);
  node('linkW0', -5.5, 0, 1); node('linkW1', -11, 0, 0); node('linkW2', -16.5, 0, 0);
  // market roof stairs (north, x=5)
  for (let i = 0; i < 8; i += 1) node('stN' + i, 5, (i + 1) * 0.375, 8.1 - i * 0.8);
  node('roofS', 4.2, 3.0, 2.6); node('roofC', 0, 3.0, 1.5); node('roofW', -4.2, 3.0, 1.2);
  node('roofN', 0, 3.0, -1.2); node('roofE', 4.2, 3.0, 0.2);
  // market roof stairs (south, x=-5)
  for (let i = 0; i < 8; i += 1) node('stS' + i, -5, (i + 1) * 0.375, -5.1 + i * 0.8);
  // A roof stairs (x=22)
  for (let i = 0; i < 8; i += 1) node('ar' + i, 22, (i + 1) * 0.375, -1.1 - i * 0.8);
  node('aroofS', 23, 3.0, -8.6); node('aroofC', 28, 3.0, -11); node('aroofN', 30, 3.0, -14);
  // B roof stairs (x=-22)
  for (let i = 0; i < 8; i += 1) node('br' + i, -22, (i + 1) * 0.375, -1.1 - i * 0.8);
  node('broofS', -23, 3.0, -8.6); node('broofC', -28, 3.0, -11); node('broofN', -30, 3.0, -14);

  // connect nodes that are physically near (auto graph, level-aware through stairs)
  for (let i = 0; i < nodes.length; i += 1) {
    for (let j = i + 1; j < nodes.length; j += 1) {
      const a = nodes[i], b = nodes[j];
      const dy = Math.abs(a.y - b.y);
      const d = Math.hypot(a.x - b.x, a.z - b.z);
      if (dy <= 0.42 && d <= 6.5) {
        a.edges.push({ to: j, w: d + dy * 2 });
        b.edges.push({ to: i, w: d + dy * 2 });
      }
    }
  }

  function nearestNode(point) {
    let best = 0, bestD = Infinity;
    for (let i = 0; i < nodes.length; i += 1) {
      const n = nodes[i];
      const d = (n.x - point.x) ** 2 + ((n.y + 0.2) - point.y) ** 2 * 4 + (n.z - point.z) ** 2;
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  function findPath(from, to) {
    const start = nearestNode(from);
    const goal = nearestNode(to);
    if (start === goal) return [nodes[goal]];
    const dist = new Float64Array(nodes.length).fill(Infinity);
    const prev = new Int32Array(nodes.length).fill(-1);
    const seen = new Uint8Array(nodes.length);
    dist[start] = 0;
    // binary-heap-free Dijkstra: the graph is tiny (under 120 nodes)
    for (let iter = 0; iter < nodes.length; iter += 1) {
      let u = -1, best = Infinity;
      for (let i = 0; i < nodes.length; i += 1) if (!seen[i] && dist[i] < best) { best = dist[i]; u = i; }
      if (u === -1 || u === goal) break;
      seen[u] = 1;
      for (const edge of nodes[u].edges) {
        const alt = dist[u] + edge.w;
        if (alt < dist[edge.to]) { dist[edge.to] = alt; prev[edge.to] = u; }
      }
    }
    if (prev[goal] === -1 && start !== goal) return [nodes[goal]];
    const path = [];
    for (let at = goal; at !== -1; at = prev[at]) { path.push(nodes[at]); if (at === start) break; }
    path.reverse();
    return path;
  }

  // ---------------------------------------------------------------- ray helpers
  function rayBox(origin, dir, box, maxT) {
    let tmin = 0, tmax = maxT;
    for (const axis of ['x', 'y', 'z']) {
      const o = origin[axis], d = dir[axis];
      const lo = box.min[axis], hi = box.max[axis];
      if (Math.abs(d) < 1e-9) { if (o < lo || o > hi) return null; continue; }
      let t1 = (lo - o) / d, t2 = (hi - o) / d;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
      if (t1 > tmin) tmin = t1;
      if (t2 < tmax) tmax = t2;
      if (tmin > tmax) return null;
    }
    return tmin;
  }

  function raycast(origin, dir, maxT) {
    let bestT = maxT, bestBox = null;
    for (const box of colliders) {
      const t = rayBox(origin, dir, box, maxT);
      if (t !== null && t < bestT) { bestT = t; bestBox = box; }
    }
    return bestBox ? { t: bestT, box: bestBox } : null;
  }

  function segmentClear(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist < 0.0001) return true;
    const dir = { x: dx / dist, y: dy / dist, z: dz / dist };
    return raycast(a, dir, dist) === null;
  }

  const tmp = { x: 0, y: 0, z: 0 };
  function update(time, dt) {
    TEX.water.offset.x = (time * 0.013) % 1;
    TEX.water.offset.y = (time * 0.009) % 1;
    water.position.y = -1.35 + Math.sin(time * 0.55) * 0.03;
    water.rotation.z = Math.sin(time * 0.08) * 0.0009;
    for (const lantern of lanterns) {
      const flicker = 0.86 + Math.sin(time * 2.3 + lantern.phase) * 0.08 + Math.sin(time * 7.1 + lantern.phase * 2) * 0.04;
      lantern.light.intensity = lantern.base * flicker;
      lantern.mesh.material.emissiveIntensity = 1.15 + flicker * 0.4;
    }
    const pos = rain.geometry.attributes.position;
    for (let i = 0; i < rainCount; i += 1) {
      let y = pos.array[i * 3 + 1] - rainVel[i] * dt;
      let x = pos.array[i * 3] + 1.4 * dt;
      if (y < -1) { y = 22 + (i % 7) * 0.4; x = ((x + 60) % 120) - 60; }
      if (x > 60) x -= 120;
      pos.array[i * 3] = x;
      pos.array[i * 3 + 1] = y;
    }
    pos.needsUpdate = true;
    for (const site of sites) site.ring.material.opacity = 0.34 + Math.sin(time * 1.7) * 0.1;
  }

  const spawns = {
    attackers: [
      { x: 0, y: 0, z: 29 }, { x: -3, y: 0, z: 28 }, { x: 3, y: 0, z: 28 }, { x: -1.4, y: 0, z: 30.2 }, { x: 1.4, y: 0, z: 30.2 },
    ],
    defenders: [
      { x: 0, y: 0, z: -29 }, { x: -3, y: 0, z: -28 }, { x: 3, y: 0, z: -28 }, { x: -1.4, y: 0, z: -30.2 }, { x: 1.4, y: 0, z: -30.2 },
    ],
  };

  return {
    group, colliders, sites, spawns, zones, nodes,
    findPath, nearestNode, zoneAt, raycast, rayBox, segmentClear, update,
    materials: mat,
  };
}
