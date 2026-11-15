// DOM + canvas HUD. Numeric fields live in fixed-width tabular containers so they never shift.
// Transient effects are advanced by tick(dt) with the game clock, not wall time.
const $ = (id) => document.getElementById(id);

export function createHud() {
  const el = {
    scoreTeal: $('score-teal'), scoreAmber: $('score-amber'),
    round: $('round-num'), timer: $('timer'), phase: $('phase'),
    health: $('health-num'), armour: $('armour-num'), money: $('money-num'),
    weaponName: $('weapon-name'), mag: $('ammo-mag'), reserve: $('ammo-reserve'),
    reloadHint: $('reload-hint'), slots: $('weapon-slots'),
    crosshair: $('crosshair'), hitmarker: $('hitmarker'), damage: $('damage'),
    radio: $('radio'), radioWho: $('radio').querySelector('.who'), radioMsg: $('radio').querySelector('.msg'),
    banner: $('round-banner'), bannerBig: $('round-banner').querySelector('.big'), bannerSub: $('round-banner').querySelector('.sub'),
    killfeed: $('killfeed'), objective: $('objective'), objectiveLabel: $('objective-label'), objectiveBar: $('objective-bar'),
    buy: $('buy'), buyMoney: $('buy-money'), buySub: $('buy-sub'), buyLoadout: $('buy-loadout'),
    scoreboard: $('scoreboard'), scoreboardBody: $('scoreboard-body'),
    spectate: $('spectate'), paused: $('paused-note'),
    minimap: $('minimap'),
  };
  const ctx = el.minimap.getContext('2d');
  const killRows = [];
  let hitTimer = 0, damageTimer = 0, radioTimer = 0, bannerTimer = 0;
  let last = {};

  // deck rectangles in world space, for the minimap (x, z, w, d)
  const DECKS = [
    [0, 28, 20, 8], [0, -28, 20, 8], [0, 2, 20, 16], [0, 17, 8, 14], [0, -15, 8, 18],
    [20, 17, 8, 14], [20, 2, 8, 16], [26, -10, 20, 20], [12, -22, 20, 4],
    [-20, 17, 8, 14], [-20, 2, 8, 16], [-26, -10, 20, 20], [-12, -22, 20, 4],
    [13, 0, 6, 4], [-13, 0, 6, 4],
  ];

  function setText(node, value, key) {
    if (last[key] === value) return;
    last[key] = value;
    node.textContent = value;
  }

  function setScores(teal, amber) {
    setText(el.scoreTeal, String(teal), 'st');
    setText(el.scoreAmber, String(amber), 'sa');
  }
  function setRound(n) { setText(el.round, String(n), 'round'); }
  function setPhase(text, defender = false) {
    if (last.phase !== text) { last.phase = text; el.phase.textContent = text; }
    el.phase.classList.toggle('def', !!defender);
  }
  function setTimer(seconds, fuse = false) {
    const clamped = Math.max(0, Math.ceil(seconds));
    const mm = Math.floor(clamped / 60);
    const ss = String(clamped % 60).padStart(2, '0');
    const text = fuse ? `${mm}:${ss}` : `${mm}:${ss}`;
    setText(el.timer, text, 'timer');
    el.timer.classList.toggle('low', clamped <= 15 || fuse);
  }
  function setVitals(health, armour, money) {
    setText(el.health, String(Math.max(0, Math.round(health))).padStart(3, ' '), 'hp');
    setText(el.armour, String(Math.max(0, Math.round(armour))).padStart(3, ' '), 'ar');
    setText(el.money, '$' + String(money).padStart(4, ' '), 'mo');
    el.health.classList.toggle('low', health <= 28);
  }
  function setWeapon(name, mag, reserve, id, owned) {
    setText(el.weaponName, name.toUpperCase(), 'wn');
    setText(el.mag, String(mag), 'mag');
    setText(el.reserve, '/ ' + reserve, 'res');
    el.mag.classList.toggle('empty', mag === 0);
    for (const span of el.slots.children) {
      const slot = span.dataset.slot;
      span.classList.toggle('on', slot === id);
      span.style.opacity = owned && owned[slot] ? '1' : '.38';
    }
  }
  function setReloadHint(text) { setText(el.reloadHint, text, 'rh'); }
  function setSpread(spread) {
    const gap = 4 + Math.min(1, spread / 0.055) * 22;
    el.crosshair.style.setProperty('--gap', gap.toFixed(1) + 'px');
  }
  function hitMarker(kill) {
    el.hitmarker.classList.add('on');
    el.hitmarker.classList.toggle('kill', !!kill);
    hitTimer = kill ? 0.22 : 0.13;
  }
  function damageFrom(deg) {
    el.damage.classList.add('on');
    el.damage.firstElementChild.style.transform = `rotate(${deg.toFixed(0)}deg)`;
    damageTimer = 0.75;
  }
  function radio(who, msg) {
    el.radioWho.textContent = who;
    el.radioMsg.textContent = msg;
    el.radio.classList.add('on');
    radioTimer = 3.4;
  }
  function banner(big, sub, cls = '', seconds = 3.2) {
    el.bannerBig.textContent = big;
    el.bannerSub.textContent = sub;
    el.banner.className = 'on ' + cls;
    bannerTimer = seconds;
  }
  function killFeed(killer, killerTeam, victim, victimTeam, weapon) {
    const row = document.createElement('div');
    row.className = 'row';
    row.innerHTML = `<span class="t ${killerTeam === 'attackers' ? 'teal' : 'amber'}">${killer}</span><span class="w">${weapon}</span><span class="t ${victimTeam === 'attackers' ? 'teal' : 'amber'}">${victim}</span>`;
    el.killfeed.prepend(row);
    killRows.unshift({ row, t: 6.5 });
    while (killRows.length > 5) killRows.pop().row.remove();
  }
  function clearBanner() { bannerTimer = 0; el.banner.classList.remove('on'); el.banner.className = ''; }
  function objective(label, progress, kind) {
    if (label) {
      el.objective.classList.add('on');
      el.objectiveLabel.textContent = label;
      el.objectiveBar.style.width = Math.max(0, Math.min(1, progress)) * 100 + '%';
      el.objectiveBar.classList.toggle('defuse', kind === 'defuse');
      el.objectiveBar.style.background = kind === 'defuse' ? '' : '';
    } else el.objective.classList.remove('on');
  }
  function spectate(name) {
    if (name) { el.spectate.textContent = `SPECTATING ${name.toUpperCase()}`; el.spectate.classList.add('on'); }
    else el.spectate.classList.remove('on');
  }
  function showBuy(open, money, ownedWeapon, roundTime) {
    el.buy.classList.toggle('on', open);
    if (!open) return;
    setText(el.buyMoney, '$' + money, 'bmo');
    setText(el.buySub, `BUY PHASE · ${Math.ceil(roundTime)}s · press 1-5`, 'bsub');
    const prices = { pistol: 0, smg: 1500, rifle: 2700, sniper: 4750, armour: 650 };
    for (const row of el.buy.querySelectorAll('.item')) {
      const kind = row.dataset.buy;
      row.classList.toggle('owned', kind === ownedWeapon || (kind === 'armour' && last.armourBought));
      row.classList.toggle('poor', prices[kind] > money);
      row.classList.toggle('on', kind === ownedWeapon);
    }
    const names = { pistol: 'P9', smg: 'CICAK', rifle: 'BADAK', sniper: 'ELANG' };
    setText(el.buyLoadout, `${names[ownedWeapon] ?? 'P9'} · ${last.armourBought ? 'kevlar' : 'no armour'}`, 'bload');
  }
  function setArmourBought(v) { last.armourBought = v; }
  function scoreboard(rows, open) {
    el.scoreboard.classList.toggle('on', open);
    if (!open) return;
    let html = '';
    for (const r of rows) {
      html += `<tr class="${r.team === 'attackers' ? 'teal' : 'amber'}"><td>${r.you ? '▸ ' : ''}${r.name}</td><td class="n">${r.kills}</td><td class="n">${r.deaths}</td><td class="n">$${r.money}</td></tr>`;
    }
    if (last.sb !== html) { last.sb = html; el.scoreboardBody.innerHTML = html; }
  }
  function setPaused(on) { el.paused.classList.toggle('on', !!on); }
  function hideOverlay() { $('overlay').hidden = true; }
  function showOverlay() { $('overlay').hidden = false; $('play').focus(); }
  function onPlay(handler) { $('play').addEventListener('click', handler); }

  function tick(dt) {
    if (hitTimer > 0) { hitTimer -= dt; if (hitTimer <= 0) { el.hitmarker.classList.remove('on'); } }
    if (damageTimer > 0) { damageTimer -= dt; if (damageTimer <= 0) el.damage.classList.remove('on'); }
    if (radioTimer > 0) { radioTimer -= dt; if (radioTimer <= 0) el.radio.classList.remove('on'); }
    if (bannerTimer > 0) { bannerTimer -= dt; if (bannerTimer <= 0) el.banner.classList.remove('on'); }
    for (let i = killRows.length - 1; i >= 0; i -= 1) {
      killRows[i].t -= dt;
      if (killRows[i].t <= 0) { killRows[i].row.remove(); killRows.splice(i, 1); }
    }
  }

  // minimap: north-up schematic, player arrow rotated by yaw, teammates, bomb blip
  function minimap(px, pz, pyaw, teammates, enemies, siteList, bomb, playerAlive, time) {
    const w = el.minimap.width, h = el.minimap.height;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#0a1520';
    ctx.fillRect(0, 0, w, h);
    const scale = 2.15, cx = w / 2, cy = h / 2 + 2;
    const X = (x) => cx + x * scale;
    const Y = (z) => cy + z * scale;
    for (const [x, z, dw, dd] of DECKS) {
      ctx.fillStyle = 'rgba(120,92,58,0.62)';
      ctx.fillRect(X(x - dw / 2), Y(z - dd / 2), dw * scale, dd * scale);
      ctx.strokeStyle = 'rgba(243,237,225,0.12)';
      ctx.lineWidth = 1;
      ctx.strokeRect(X(x - dw / 2), Y(z - dd / 2), dw * scale, dd * scale);
    }
    for (const site of siteList) {
      ctx.strokeStyle = site.color;
      ctx.globalAlpha = 0.75; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(X(site.x), Y(site.z), site.radius * scale, 0, Math.PI * 2); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.fillStyle = site.color;
      ctx.font = 'bold 12px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(site.id, X(site.x), Y(site.z));
    }
    for (const mate of teammates) {
      if (!mate.alive) continue;
      ctx.fillStyle = mate.you ? '#ffffff' : '#2fd6c4';
      ctx.beginPath(); ctx.arc(X(mate.x), Y(mate.z), mate.you ? 3.4 : 2.6, 0, Math.PI * 2); ctx.fill();
    }
    if (bomb && bomb.planted) {
      const pulse = 1.5 + Math.sin(time * 8) * 1.2;
      ctx.fillStyle = '#ffb347';
      ctx.beginPath(); ctx.arc(X(bomb.x), Y(bomb.z), pulse + 2, 0, Math.PI * 2); ctx.fill();
    }
    if (playerAlive) {
      ctx.save();
      ctx.translate(X(px), Y(pz));
      ctx.rotate(-pyaw);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.moveTo(0, -6); ctx.lineTo(4.2, 5); ctx.lineTo(-4.2, 5); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
  }

  return {
    setScores, setRound, setPhase, setTimer, setVitals, setWeapon, setReloadHint, setSpread,
    hitMarker, damageFrom, radio, banner, clearBanner, killFeed, objective, spectate, showBuy, setArmourBought,
    scoreboard, setPaused, hideOverlay, showOverlay, onPlay, tick, minimap,
  };
}
