// APUNG's look plan: a dusk lagoon village. Six core values plus materials read by world.js.
export const PALETTE = {
  skyTop: '#1b2740',
  skyMid: '#5a4a6e',
  skyLow: '#d9895f',
  night: '#16202b',
  fog: '#4a4458',
  water: '#24414a',
  waterGlint: '#7fb7b4',
  wood: '#6b4a30',
  woodDark: '#42301f',
  woodLight: '#8a6746',
  plaster: '#d3c1a2',
  plasterDark: '#a08c72',
  roof: '#3b3742',
  stone: '#767b84',
  crate: '#8a6238',
  teal: '#2fd6c4',
  tealDeep: '#0f8f86',
  amber: '#ffb347',
  amberDeep: '#c9772a',
  ink: '#f3ede1',
  muted: '#a8b2bd',
  lantern: '#ffd08a',
  ember: '#ff9a4d',
  leaf: '#4f6b4a',
};

export function shade(name) {
  return PALETTE[name] ?? '#ffffff';
}
