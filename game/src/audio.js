// Procedural WebAudio only: no files, no network. Every one-shot detunes by ±6% from the seeded
// gameplay RNG, so two runs of the same seed sound the same.
export function createAudio(rng) {
  let ac = null;
  let master = null;
  let noise = null;
  let ambientStarted = false;

  function init() {
    if (ac) return ac;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return null;
    try {
      ac = new Ctx();
      master = ac.createGain();
      master.gain.value = 0.55;
      master.connect(ac.destination);
      const len = Math.floor(ac.sampleRate * 1.2);
      noise = ac.createBuffer(1, len, ac.sampleRate);
      const data = noise.getChannelData(0);
      for (let i = 0; i < len; i += 1) data[i] = rng.range(-1, 1);
    } catch { ac = null; }
    return ac;
  }

  function resume() {
    const ctx = init();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    if (!ambientStarted) { ambientStarted = true; startAmbient(); }
  }

  function now() { return ac ? ac.currentTime : 0; }

  function burst({ dur = 0.16, freq = 1200, q = 0.7, gain = 0.5, type = 'bandpass', detune = 0, delay = 0 }) {
    if (!ac) return;
    const t = now() + delay;
    const src = ac.createBufferSource();
    src.buffer = noise;
    src.playbackRate.value = 1 + detune;
    const filter = ac.createBiquadFilter();
    filter.type = type; filter.frequency.value = freq; filter.Q.value = q;
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter); filter.connect(env); env.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }

  function tone({ freq = 440, dur = 0.12, gain = 0.14, type = 'sine', detune = 0, delay = 0, slide = 0 }) {
    if (!ac) return;
    const t = now() + delay;
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq * (1 + detune), t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq * slide), t + dur);
    const env = ac.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(gain, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env); env.connect(master);
    osc.start(t); osc.stop(t + dur + 0.02);
  }

  function startAmbient() {
    if (!ac) return;
    const t = now();
    // lagoon wash: low-passed noise
    const wash = ac.createBufferSource(); wash.buffer = noise; wash.loop = true;
    const lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.Q.value = 0.4;
    const wg = ac.createGain(); wg.gain.value = 0.055;
    wash.connect(lp); lp.connect(wg); wg.connect(master); wash.start(t);
    // drizzle: band-passed noise
    const rain = ac.createBufferSource(); rain.buffer = noise; rain.loop = true; rain.playbackRate.value = 1.7;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.25;
    const rg = ac.createGain(); rg.gain.value = 0.018;
    rain.connect(bp); bp.connect(rg); rg.connect(master); rain.start(t);
    // distant hum
    const hum = ac.createOscillator(); hum.type = 'sine'; hum.frequency.value = 54;
    const hg = ac.createGain(); hg.gain.value = 0.02;
    hum.connect(hg); hg.connect(master); hum.start(t);
  }

  return {
    resume,
    get ready() { return !!ac; },
    shot(kind = 'rifle') {
      const d = rng.range(-0.06, 0.06);
      if (kind === 'sniper') { burst({ dur: 0.34, freq: 700, gain: 0.85, detune: d }); tone({ freq: 84, dur: 0.24, gain: 0.3, type: 'triangle', slide: 0.5, detune: d }); }
      else if (kind === 'pistol') { burst({ dur: 0.12, freq: 1500, gain: 0.45, detune: d }); tone({ freq: 150, dur: 0.07, gain: 0.16, type: 'square', slide: 0.6, detune: d }); }
      else if (kind === 'smg') { burst({ dur: 0.09, freq: 1900, gain: 0.4, detune: d }); tone({ freq: 190, dur: 0.05, gain: 0.12, type: 'square', detune: d }); }
      else { burst({ dur: 0.15, freq: 1100, gain: 0.55, detune: d }); tone({ freq: 110, dur: 0.09, gain: 0.18, type: 'triangle', slide: 0.6, detune: d }); }
    },
    hit(kill) {
      tone({ freq: kill ? 1320 : 1760, dur: kill ? 0.09 : 0.05, gain: kill ? 0.2 : 0.13, type: 'square', detune: rng.range(-0.03, 0.03) });
      if (kill) tone({ freq: 880, dur: 0.12, gain: 0.12, type: 'sine', delay: 0.06 });
    },
    hurt() { burst({ dur: 0.18, freq: 240, gain: 0.35, type: 'lowpass' }); },
    footstep() { burst({ dur: 0.07, freq: 320, q: 0.9, gain: 0.09, type: 'lowpass' }); },
    reload() { tone({ freq: 520, dur: 0.05, gain: 0.08, type: 'square' }); tone({ freq: 720, dur: 0.05, gain: 0.07, type: 'square', delay: 0.09 }); },
    plantBeep() { tone({ freq: 1180, dur: 0.07, gain: 0.12, type: 'square', detune: rng.range(-0.02, 0.02) }); },
    defuseTick() { tone({ freq: 820, dur: 0.05, gain: 0.09, type: 'triangle' }); },
    explode() { burst({ dur: 0.9, freq: 180, gain: 1.0, type: 'lowpass' }); tone({ freq: 52, dur: 0.9, gain: 0.35, type: 'sine', slide: 0.4 }); },
    radio() { burst({ dur: 0.09, freq: 1600, q: 2, gain: 0.12 }); tone({ freq: 920, dur: 0.06, gain: 0.06, type: 'square', delay: 0.03 }); },
    win() {
      [523, 659, 784, 1046].forEach((f, i) => tone({ freq: f, dur: 0.24, gain: 0.12, type: 'triangle', delay: i * 0.09 }));
    },
    lose() {
      [392, 349, 294, 233].forEach((f, i) => tone({ freq: f, dur: 0.3, gain: 0.1, type: 'sine', delay: i * 0.1 }));
    },
    buy() { tone({ freq: 660, dur: 0.08, gain: 0.1, type: 'square' }); tone({ freq: 990, dur: 0.1, gain: 0.08, type: 'square', delay: 0.06 }); },
  };
}
