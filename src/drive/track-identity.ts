// Identity colours deliberately avoid the red/amber hazard palette. The colour
// is derived only from the stable track ID, so a vehicle does not change colour
// when its range or risk state changes.
const TRACK_COLOURS=[
  '#39d5ff','#a78bfa','#5ee6a8','#6ea8ff',
  '#f183d1','#52e0d2','#b5e85b','#c890ff',
  '#44c2a8','#8a9cff','#79e27c','#d38cff'
] as const;

export function trackColour(trackId:number):string {
  const id=Number.isFinite(trackId)?Math.max(1,Math.trunc(Math.abs(trackId))):1;
  return TRACK_COLOURS[(id-1)%TRACK_COLOURS.length];
}

export const TRACK_IDENTITY_COLOUR_COUNT=TRACK_COLOURS.length;
