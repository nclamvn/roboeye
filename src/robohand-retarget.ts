import { ROBOT_HAND_SEGMENTS, type Vec3 } from './robohand-types';

/** Original browser IK; inspired by contact-aware objectives, not a GeoRT model. */
export interface HandContact { a: number; b: number; weight: number; distance: number }
export interface HandTask { tips: Vec3[]; tipDirections: Vec3[]; contacts: HandContact[] }
export const HAND_TIPS = [4, 8, 12, 16, 20] as const;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const add = (a: Vec3, b: Vec3): Vec3 => ({ x:a.x+b.x, y:a.y+b.y, z:a.z+b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x:a.x-b.x, y:a.y-b.y, z:a.z-b.z });
const mul = (a: Vec3, s: number): Vec3 => ({ x:a.x*s, y:a.y*s, z:a.z*s });
const dot = (a: Vec3, b: Vec3) => a.x*b.x+a.y*b.y+a.z*b.z;
const cross = (a: Vec3, b: Vec3): Vec3 => ({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
const norm = (a: Vec3) => Math.hypot(a.x,a.y,a.z);
const unit = (a: Vec3, fallback: Vec3={x:1,y:0,z:0}) => norm(a)>1e-8?mul(a,1/norm(a)):{...fallback};
const mix = (a: Vec3,b: Vec3,t:number) => add(mul(a,1-t),mul(b,t));
const rotate = (v: Vec3, axis: Vec3, angle: number) => add(add(mul(v,Math.cos(angle)),mul(cross(axis,v),Math.sin(angle))),mul(axis,dot(axis,v)*(1-Math.cos(angle))));

/**
 * Project a flexed finger back onto one stable anatomical flexion plane.
 *
 * Camera landmarks can independently move PIP/DIP directions across frames.
 * Filtering those directions separately may then produce an impossible chain:
 * PIP bends to one side while DIP bends through the opposite side.  Open
 * fingers are intentionally returned byte-for-byte; only clearly flexed
 * fingers are conditioned.
 */
export function constrainHandAnatomy(points: Vec3[], fingerCurls?: readonly number[]): Vec3[] {
  if(points.length!==21)return points.map(point=>({...point}));
  const output=points.map(point=>({...point}));
  for(let finger=0;finger<5;finger++){
    const base=finger*4+1;
    const d1=unit(sub(points[base+1],points[base]));
    const d2=unit(sub(points[base+2],points[base+1]),d1);
    const d3=unit(sub(points[base+3],points[base+2]),d2);
    const bend1=Math.acos(clamp(dot(d1,d2),-1,1));
    const bend2=Math.acos(clamp(dot(d2,d3),-1,1));
    const lengths=ROBOT_HAND_SEGMENTS.slice(finger*4+1,finger*4+4).map(segment=>segment.length);
    const reach=norm(sub(points[base+3],points[base]))/Math.max(1e-6,lengths.reduce((sum,value)=>sum+value,0));
    const measuredCurl=clamp(fingerCurls?.[finger]??0,0,1);
    // Preserve open/free articulation exactly. This also avoids introducing
    // work on the overwhelmingly common relaxed-hand path.
    const curlStart=finger===0?.68:.58;
    if(reach>.84&&bend1+bend2<.42&&measuredCurl<curlStart)continue;

    const cross1=cross(d1,d2),cross2=cross(d2,d3);
    let plane=add(mul(cross1,Math.max(.08,bend1)),mul(cross2,Math.max(.08,bend2)));
    const tangent=unit({x:d1.y,y:-d1.x,z:0},{x:1,y:0,z:0});
    if(norm(plane)<1e-5)plane=measuredCurl>curlStart?mul(tangent,-1):{...tangent};
    plane=unit(plane,tangent);
    // The flexion axis should remain approximately transverse to the finger.
    // Preserve which side the observed hand curls toward, while rejecting the
    // lateral axis flip that makes a fist visually explode.
    const signedTangent=dot(plane,tangent)<0?mul(tangent,-1):tangent;
    const planarConfidence=clamp((bend1+bend2-.32)/1.4,0,.78);
    plane=unit(mix(plane,signedTangent,planarConfidence),signedTangent);
    if(dot(cross1,plane)<0&&dot(cross2,plane)<0)plane=mul(plane,-1);

    const maxPip=finger===0?1.45:1.72;
    const maxDip=finger===0?1.35:1.55;
    const signedBend1=Math.atan2(dot(cross1,plane),clamp(dot(d1,d2),-1,1));
    const signedBend2=Math.atan2(dot(cross2,plane),clamp(dot(d2,d3),-1,1));
    const closure=clamp((measuredCurl-curlStart)/(finger===0?.26:.34),0,1);
    // Minimum flexion is driven by measured curl, never by a discrete FIST
    // label. This preserves continuous motion while preventing an occluded
    // fingertip from exploding an otherwise compact fist.
    const minimumPip=closure*(finger===0?.72:1.08);
    const minimumDip=closure*(finger===0?.50:.76);
    const safeBend1=clamp(Math.max(signedBend1,minimumPip),0,maxPip);
    const safeBend2=clamp(Math.max(signedBend2,minimumDip),0,maxDip);
    const safeD2=unit(rotate(d1,plane,safeBend1),d2);
    const safeD3=unit(rotate(safeD2,plane,safeBend2),d3);
    output[base+1]=add(output[base],mul(d1,lengths[0]));
    output[base+2]=add(output[base+1],mul(safeD2,lengths[1]));
    output[base+3]=add(output[base+2],mul(safeD3,lengths[2]));
  }
  return output;
}

/** Palm-local source points, before changing human bone lengths. */
export function createHandTask(source: Vec3[], robot: Vec3[], image?: Vec3[]): HandTask {
  const span=norm(sub(source[5],source[17]));
  const imageSpan=image?.length===21?Math.hypot(image[5].x-image[17].x,image[5].y-image[17].y):0;
  const scale=norm(sub(robot[5],robot[17]))/Math.max(span,1e-6);
  let offset={x:0,y:0,z:0};
  for(const id of [1,5,9,13,17]) offset=add(offset,mul(sub(robot[id],mul(source[id],scale)),.2));
  const tips=HAND_TIPS.map(id=>add(mul(source[id],scale),offset));
  const contacts: HandContact[]=[];
  for(let a=0;a<5;a++)for(let b=a+1;b<5;b++){
    const worldRatio=norm(sub(source[HAND_TIPS[a]],source[HAND_TIPS[b]]))/Math.max(span,1e-6);
    let ratio=worldRatio;
    if(image?.length===21&&imageSpan>1e-6){
      const pa=image[HAND_TIPS[a]],pb=image[HAND_TIPS[b]];
      const imageRatio=Math.hypot(pa.x-pb.x,pa.y-pb.y)/imageSpan;
      const depthRatio=Math.abs(source[HAND_TIPS[a]].z-source[HAND_TIPS[b]].z)/Math.max(span,1e-6);
      // Screen proximity may rescue noisy world x/y, but can never create a
      // contact on its own: 3D depth consistency and a broad world-space gate
      // are both mandatory.
      if(imageRatio<.20&&depthRatio<.16&&worldRatio<.36)
        ratio=Math.min(worldRatio,Math.max(imageRatio,depthRatio));
    }
    // Smooth transition, not a binary gesture snap. Thresholds are normalized
    // palm fractions (not metres). Small nonzero separation preserves distinct tips.
    const t=clamp((.22-ratio)/.14,0,1), weight=t*t*(3-2*t);
    if(weight>0)contacts.push({a,b,weight,distance:.025});
  }
  return {tips,tipDirections:HAND_TIPS.map(id=>unit(sub(source[id],source[id-1]))),contacts};
}

type JointState = number[]; // proximal yaw/elevation, flexion-plane roll, PIP, DIP
function stateFromPoints(points: Vec3[], finger: number): JointState {
  const i=finger*4+1, d1=unit(sub(points[i+1],points[i]));
  const d2=unit(sub(points[i+2],points[i+1])), d3=unit(sub(points[i+3],points[i+2]));
  const yaw=Math.atan2(d1.x,d1.y), elevation=Math.atan2(d1.z,Math.hypot(d1.x,d1.y));
  const t1={x:Math.cos(yaw),y:-Math.sin(yaw),z:0}, t2=unit(cross(d1,t1));
  const axis=unit(cross(d1,d2),t1);
  return [yaw,elevation,Math.atan2(dot(axis,t2),dot(axis,t1)),
    Math.acos(clamp(dot(d1,d2),-1,1)), Math.atan2(dot(cross(d2,d3),axis),dot(d2,d3))];
}

function chain(q: JointState, anchor: Vec3, finger: number): Vec3[] {
  const [yaw,elevation,roll,bend1,bend2]=q;
  const d1={x:Math.sin(yaw)*Math.cos(elevation),y:Math.cos(yaw)*Math.cos(elevation),z:Math.sin(elevation)};
  const axis=rotate({x:Math.cos(yaw),y:-Math.sin(yaw),z:0},d1,roll);
  const d2=rotate(d1,axis,bend1), d3=rotate(d2,axis,bend2);
  const points=[{...anchor}];
  [d1,d2,d3].forEach((d,k)=>points.push(add(points[k],mul(d,ROBOT_HAND_SEGMENTS[finger*4+k+1].length))));
  return points;
}

/** Contact-first damped IK; distal orientation lives in the Jacobian null space. */
function stepIK(q: JointState, anchor: Vec3, finger: number, target: Vec3, reference: JointState, tipDirection: Vec3): void {
  const current=chain(q,anchor,finger), tip=current[3], error=sub(target,tip);
  const distal=unit(sub(current[3],current[2])), orientationError=sub(tipDirection,distal);
  const jac: Vec3[]=[];
  const orientationJac: Vec3[]=[];
  for(let k=0;k<5;k++){
    const probe=q.slice();probe[k]+=.001;
    const shifted=chain(probe,anchor,finger);
    jac.push(mul(sub(shifted[3],tip),1000));
    orientationJac.push(mul(sub(unit(sub(shifted[3],shifted[2])),distal),1000));
  }
  const m=[[.001,0,0],[0,.001,0],[0,0,.001]];
  for(const j of jac){const v=[j.x,j.y,j.z];for(let r=0;r<3;r++)for(let c=0;c<3;c++)m[r][c]+=v[r]*v[c];}
  const solve=(value:Vec3):Vec3=>{
    const matrix=m.map(row=>row.slice()),rhs=[value.x,value.y,value.z];
    for(let r=0;r<3;r++){
      const pivot=matrix[r][r];for(let c=r;c<3;c++)matrix[r][c]/=pivot;rhs[r]/=pivot;
      for(let row=0;row<3;row++)if(row!==r){const f=matrix[row][r];for(let c=r;c<3;c++)matrix[row][c]-=f*matrix[r][c];rhs[row]-=f*rhs[r];}
    }
    return {x:rhs[0],y:rhs[1],z:rhs[2]};
  };
  const positional=solve(error);
  const secondary=orientationJac.map(j=>dot(j,orientationError)*.04);
  let induced={x:0,y:0,z:0};
  jac.forEach((j,k)=>{induced=add(induced,mul(j,secondary[k]));});
  const compensation=solve(induced);
  for(let k=0;k<5;k++)q[k]+=clamp(dot(jac[k],positional)+secondary[k]-dot(jac[k],compensation),-.22,.22);
  // Local correction trust region prevents arbitrary IK branch switches.
  q[0]=clamp(q[0],reference[0]-.95,reference[0]+.95);
  q[1]=clamp(q[1],Math.max(-1.55,reference[1]-1.1),Math.min(1.55,reference[1]+1.1));
  q[2]=clamp(q[2],reference[2]-.65,reference[2]+.65);
  q[3]=clamp(q[3],0,1.95);q[4]=clamp(q[4],-.12,1.8);
}

/** Fixed palm + fixed bone lengths + planar interphalangeal bends. Bounded work.
 * Contacts are solved jointly rather than moving every fingertip to one point.
 * Caller must run this after smoothing; interpolating bones alone breaks contact.
 */
export function retargetHand(points: Vec3[], task: HandTask, iterations=18): Vec3[] {
  const output=points.map(p=>({...p}));
  const active=[0,0,0,0,0];
  for(const c of task.contacts){active[c.a]=Math.max(active[c.a],c.weight);active[c.b]=Math.max(active[c.b],c.weight);}
  if(!active.some(Boolean))return output;
  const reference=HAND_TIPS.map((_,f)=>stateFromPoints(points,f));
  const states=reference.map(q=>q.slice());
  const bases=HAND_TIPS.map((_,f)=>points[f*4+1]);
  // Free fingers retain measured articulation. Global position-fitting them
  // would curl an OPEN finger just because the robot phalanges are longer.
  const goals=task.tips.map((p,f)=>mix(points[HAND_TIPS[f]],p,.65*active[f]));
  for(const c of task.contacts){
    goals[c.a]=mix(goals[c.a],task.tips[c.a],c.weight);
    goals[c.b]=mix(goals[c.b],task.tips[c.b],c.weight);
  }
  const tips=goals.map(p=>({...p}));
  // Coincident measured landmarks give no separation direction. Seed a tiny
  // non-collinear simplex so multi-finger constraints cannot settle into a
  // collinear collapsed solution (three pairwise contacts are not one point).
  const seeds=[{x:0,y:0,z:-1},{x:1,y:0,z:0},{x:-.5,y:.866,z:0},{x:-.5,y:-.866,z:0},{x:0,y:0,z:1}];
  const proximity=[0,0,0,0,0];
  for(const c of task.contacts){
    const t=clamp(1-norm(sub(tips[c.a],tips[c.b]))/.018,0,1);
    const strength=t*t*(3-2*t)*c.weight;
    proximity[c.a]=Math.max(proximity[c.a],strength);proximity[c.b]=Math.max(proximity[c.b],strength);
  }
  for(let f=0;f<5;f++)tips[f]=add(tips[f],mul(seeds[f],.0125*proximity[f]));
  // Relax a small complete contact graph. No union-to-a-single-tip collapse.
  for(let n=0;n<12;n++)for(const c of task.contacts){
    const delta=sub(tips[c.b],tips[c.a]), distance=norm(delta);
    const direction=unit(delta,unit(sub(points[HAND_TIPS[c.b]],points[HAND_TIPS[c.a]])));
    const correction=mul(direction,(distance-c.distance)*.5*c.weight);
    tips[c.a]=add(tips[c.a],correction);tips[c.b]=sub(tips[c.b],correction);
  }
  for(let n=0;n<iterations;n++){
    for(let f=0;f<5;f++)if(active[f]>0)stepIK(states[f],bases[f],f,tips[f],reference[f],task.tipDirections[f]);
  }
  for(let f=0;f<5;f++){
    if(active[f]===0)continue;
    const solved=chain(states[f],bases[f],f);
    for(let k=1;k<=3;k++)output[f*4+1+k]=solved[k];
  }
  return output;
}

export function directionsFromPoints(points: Vec3[]): Vec3[] {
  return ROBOT_HAND_SEGMENTS.map(s=>unit(sub(points[s.child],points[s.parent])));
}

export function contactResidual(points: Vec3[], contacts: HandContact[]): number {
  return Math.max(0,...contacts.filter(c=>c.weight>.95).map(c=>Math.abs(norm(sub(points[HAND_TIPS[c.a]],points[HAND_TIPS[c.b]]))-c.distance)));
}
