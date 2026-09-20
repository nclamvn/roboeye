/** CSS-pixel coordinates in the stage, using its existing contain rectangle. */
export function laneIconPosition(x:number,y:number,w:number,h:number,chromeBottom:number) {
  const inset=Math.min(12,Math.max(0,Math.min(w,h)/8));
  const size=Math.max(0,Math.min(42,w-2*inset,h-2*inset));
  return {left:x+inset,top:Math.min(y+h-inset-size,Math.max(y+inset,chromeBottom+8)),size};
}
