import { RealtimeValueFilter } from './realtime-point-filter';
import { classifyRobotHandGesture, RobotHandGestureStabilizer, type RobotHandGesture } from './robohand-gestures';
import { ROBOT_HAND_SEGMENTS, type Quaternion, type RobotFingerCurls, type RobotHandPose, type Vec3 } from './robohand-types';
import type { HandLandmark } from './airsketch-types';
import { constrainHandAnatomy, retargetHand, directionsFromPoints, type HandContact } from './robohand-retarget';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalized(value: Vec3, fallback: Vec3): Vec3 {
  const magnitude = Math.hypot(value.x, value.y, value.z);
  return magnitude > 1e-6 && Number.isFinite(magnitude)
    ? { x: value.x / magnitude, y: value.y / magnitude, z: value.z / magnitude }
    : { ...fallback };
}

function quaternionDot(a: Quaternion, b: Quaternion): number {
  return a.x * b.x + a.y * b.y + a.z * b.z + a.w * b.w;
}

function quaternionSlerp(a: Quaternion, b: Quaternion, amount: number): Quaternion {
  let target = b;
  let cosine = quaternionDot(a, b);
  if (cosine < 0) {
    cosine = -cosine;
    target = { x: -b.x, y: -b.y, z: -b.z, w: -b.w };
  }
  if (cosine > .9995) {
    const result = {
      x: a.x + (target.x - a.x) * amount,
      y: a.y + (target.y - a.y) * amount,
      z: a.z + (target.z - a.z) * amount,
      w: a.w + (target.w - a.w) * amount
    };
    const magnitude = Math.hypot(result.x, result.y, result.z, result.w) || 1;
    return { x: result.x / magnitude, y: result.y / magnitude, z: result.z / magnitude, w: result.w / magnitude };
  }
  const angle = Math.acos(clamp(cosine, -1, 1));
  const sine = Math.sin(angle);
  const fromWeight = Math.sin((1 - amount) * angle) / sine;
  const toWeight = Math.sin(amount * angle) / sine;
  return {
    x: a.x * fromWeight + target.x * toWeight,
    y: a.y * fromWeight + target.y * toWeight,
    z: a.z * fromWeight + target.z * toWeight,
    w: a.w * fromWeight + target.w * toWeight
  };
}

class DirectionFilter {
  private readonly x = new RealtimeValueFilter({ minCutoff: 2.15, beta: 8.5, derivativeCutoff: 1.2 });
  private readonly y = new RealtimeValueFilter({ minCutoff: 2.15, beta: 8.5, derivativeCutoff: 1.2 });
  private readonly z = new RealtimeValueFilter({ minCutoff: 2.15, beta: 8.5, derivativeCutoff: 1.2 });

  update(value: Vec3, at: number): Vec3 {
    return normalized({
      x: this.x.update(value.x, at),
      y: this.y.update(value.y, at),
      z: this.z.update(value.z, at)
    }, value);
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
    this.z.reset();
  }
}

class RootPositionFilter {
  private readonly x = new RealtimeValueFilter({ minCutoff: 2, beta: 3.6, derivativeCutoff: 1.1 });
  private readonly y = new RealtimeValueFilter({ minCutoff: 2, beta: 3.6, derivativeCutoff: 1.1 });
  private readonly z = new RealtimeValueFilter({ minCutoff: 1.7, beta: 2.4, derivativeCutoff: 1.1 });
  private previous: (Vec3 & { t: number }) | null = null;
  private velocity: Vec3 = { x: 0, y: 0, z: 0 };

  update(value: Vec3, capturedAt: number, visibleAt: number): Vec3 {
    const stable = {
      x: this.x.update(value.x, capturedAt),
      y: this.y.update(value.y, capturedAt),
      z: this.z.update(value.z, capturedAt)
    };
    if (this.previous) {
      const elapsed = Math.max(8, capturedAt - this.previous.t);
      const measured = {
        x: (stable.x - this.previous.x) / elapsed,
        y: (stable.y - this.previous.y) / elapsed,
        z: (stable.z - this.previous.z) / elapsed
      };
      this.velocity.x += (measured.x - this.velocity.x) * .62;
      this.velocity.y += (measured.y - this.velocity.y) * .62;
      this.velocity.z += (measured.z - this.velocity.z) * .62;
    }
    this.previous = { ...stable, t: capturedAt };
    const horizon = clamp(visibleAt - capturedAt, 0, 35);
    let prediction = {
      x: this.velocity.x * horizon,
      y: this.velocity.y * horizon,
      z: this.velocity.z * horizon
    };
    const magnitude = Math.hypot(prediction.x, prediction.y, prediction.z);
    if (magnitude > .12) prediction = {
      x: prediction.x * .12 / magnitude,
      y: prediction.y * .12 / magnitude,
      z: prediction.z * .12 / magnitude
    };
    return { x: stable.x + prediction.x, y: stable.y + prediction.y, z: stable.z + prediction.z };
  }

  reset(): void {
    this.x.reset();
    this.y.reset();
    this.z.reset();
    this.previous = null;
    this.velocity = { x: 0, y: 0, z: 0 };
  }
}

export class RobotHandPoseFilter {
  private readonly tipFilters = Array.from({length:5}, () =>
    ['x','y','z'].map(() => new RealtimeValueFilter({minCutoff:4,beta:25,derivativeCutoff:1.5})));
  private readonly directionFilters = ROBOT_HAND_SEGMENTS.map(() => new DirectionFilter());
  private readonly rootPosition = new RootPositionFilter();
  private readonly rootScale = new RealtimeValueFilter({ minCutoff: 1.6, beta: 2.8 });
  private readonly curlFilters = Array.from({length:5}, () =>
    new RealtimeValueFilter({minCutoff:3.2,beta:8.5,derivativeCutoff:1.4}));
  private readonly contactWeights = new Map<string,number>();
  private orientation: Quaternion | null = null;
  private orientationAt = -Infinity;
  private handedness: RobotHandPose['handedness'] = 'Unknown';
  private handednessCandidate: RobotHandPose['handedness'] = 'Unknown';
  private handednessSamples = 0;

  private stabilizeContacts(raw: HandContact[]): HandContact[] {
    const byKey=new Map(raw.map(contact=>[
      `${Math.min(contact.a,contact.b)}:${Math.max(contact.a,contact.b)}`,contact
    ]));
    const stable: HandContact[]=[];
    for(let a=0;a<5;a++)for(let b=a+1;b<5;b++){
      const key=`${a}:${b}`, contact=byKey.get(key), previous=this.contactWeights.get(key)??0;
      const target=contact?.weight??0;
      // Fast acquisition, slower release. A one-frame landmark dropout no
      // longer tears apart a real pinch, but a deliberate opening still clears
      // the constraint in a small, bounded number of frames.
      let next=target>previous?previous+(target-previous)*.82:previous*.70;
      if(target>.92)next=target;
      if(next<.015)this.contactWeights.delete(key);else this.contactWeights.set(key,next);
      if(next>=.015)stable.push({a,b,weight:next,distance:contact?.distance??.025});
    }
    return stable;
  }

  update(pose: RobotHandPose, visibleAt = pose.receivedAt): RobotHandPose {
    const directions = pose.directions.map((direction, index) => this.directionFilters[index].update(direction, pose.capturedAt));
    const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
    ROBOT_HAND_SEGMENTS.forEach((segment, index) => {
      const parent = points[segment.parent];
      const direction = directions[index];
      points[segment.child] = {
        x: parent.x + direction.x * segment.length,
        y: parent.y + direction.y * segment.length,
        z: parent.z + direction.z * segment.length
      };
    });

    const rootPosition = this.rootPosition.update(pose.rootPosition, pose.capturedAt, visibleAt);
    const fingerCurls = pose.fingerCurls?.map((value,index)=>
      this.curlFilters[index].update(value,pose.capturedAt)) as RobotFingerCurls|undefined;
    const elapsed = clamp((pose.capturedAt - this.orientationAt) / 1_000, 1 / 240, .1);
    if (!this.orientation) this.orientation = { ...pose.rootOrientation };
    else {
      const cosine = Math.abs(quaternionDot(this.orientation, pose.rootOrientation));
      const angularSpeed = 2 * Math.acos(clamp(cosine, -1, 1)) / elapsed;
      const cutoff = 2 + angularSpeed * .34;
      const tau = 1 / (2 * Math.PI * cutoff);
      this.orientation = quaternionSlerp(this.orientation, pose.rootOrientation, 1 / (1 + tau / elapsed));
    }
    this.orientationAt = pose.capturedAt;

    if (pose.handedness !== 'Unknown' && pose.handedness !== this.handedness) {
      if (pose.handedness !== this.handednessCandidate) {
        this.handednessCandidate = pose.handedness;
        this.handednessSamples = 1;
      } else if (++this.handednessSamples >= 3 || this.handedness === 'Unknown') {
        this.handedness = pose.handedness;
        this.handednessSamples = 0;
      }
    } else {
      this.handednessCandidate = this.handedness;
      this.handednessSamples = 0;
    }

    const handTask = pose.handTask ? {
      tipDirections: [3,7,11,15,19].map(i=>({...directions[i]})),
      tips: pose.handTask.tips.map((p,f) => ({
        x:this.tipFilters[f][0].update(p.x,pose.capturedAt),
        y:this.tipFilters[f][1].update(p.y,pose.capturedAt),
        z:this.tipFilters[f][2].update(p.z,pose.capturedAt)
      })),
      contacts:this.stabilizeContacts(pose.handTask.contacts)
    } : undefined;
    // Condition the complete articulated chain before contact IK. Running the
    // One-Euro filters per segment is responsive, but without this projection
    // a deep fist can put PIP and DIP on opposite flexion planes.
    const anatomyCurls=fingerCurls?[...fingerCurls]:undefined;
    // Contact IK is the stronger observation for fingers that are actually
    // touching. Do not let the fist-occlusion regularizer fight a measured
    // pinch target and reintroduce fingertip jitter.
    if(anatomyCurls&&handTask)for(const contact of handTask.contacts)if(contact.weight>.2){
      anatomyCurls[contact.a]=0;anatomyCurls[contact.b]=0;
    }
    const anatomical = constrainHandAnatomy(points,anatomyCurls);
    const articulated = handTask ? retargetHand(anatomical,handTask) : anatomical;
    return {
      ...pose,
      handTask,
      points:articulated,
      directions:directionsFromPoints(articulated),
      fingerCurls,
      rootPosition,
      rootOrientation: { ...this.orientation },
      rootScale: this.rootScale.update(pose.rootScale, pose.capturedAt),
      handedness: this.handedness,
      receivedAt: visibleAt
    };
  }

  reset(): void {
    this.tipFilters.forEach(filters=>filters.forEach(filter=>filter.reset()));
    this.directionFilters.forEach((filter) => filter.reset());
    this.rootPosition.reset();
    this.rootScale.reset();
    this.curlFilters.forEach(filter=>filter.reset());
    this.contactWeights.clear();
    this.orientation = null;
    this.orientationAt = -Infinity;
    this.handedness = 'Unknown';
    this.handednessCandidate = 'Unknown';
    this.handednessSamples = 0;
  }
}

export interface RobotHandRealtimeResult {
  pose: RobotHandPose | null;
  gesture: RobotHandGesture | 'HOLD' | 'REST';
  state: 'live' | 'predict' | 'hold' | 'rest';
}

export interface RobotHandContinuitySnapshot {
  predictedFrames:number;
  heldFrames:number;
  reacquisitions:number;
  maxGapMs:number;
}

export class RobotHandRealtimeController {
  private readonly filter = new RobotHandPoseFilter();
  private readonly gestures = new RobotHandGestureStabilizer();
  private lastPose: RobotHandPose | null = null;
  private lastOutputPose: RobotHandPose | null = null;
  private previousLivePose: RobotHandPose | null = null;
  private lastSeenAt = -Infinity;
  private rootVelocity:Vec3={x:0,y:0,z:0};
  private reacquireFrames=0;
  private continuity:RobotHandContinuitySnapshot={predictedFrames:0,heldFrames:0,reacquisitions:0,maxGapMs:0};

  constructor(private readonly lossGraceMs = 420,private readonly predictionHorizonMs=180) {}

  update(pose: RobotHandPose, landmarks: HandLandmark[], now: number): RobotHandRealtimeResult {
    const gap=now-this.lastSeenAt;
    let filtered=this.filter.update(pose, now);
    if(this.previousLivePose){
      const elapsed=Math.max(8,now-this.lastSeenAt);
      const measured={
        x:(filtered.rootPosition.x-this.previousLivePose.rootPosition.x)/elapsed,
        y:(filtered.rootPosition.y-this.previousLivePose.rootPosition.y)/elapsed,
        z:(filtered.rootPosition.z-this.previousLivePose.rootPosition.z)/elapsed
      };
      const magnitude=Math.hypot(measured.x,measured.y,measured.z);
      const bounded=magnitude>.006?{x:measured.x*.006/magnitude,y:measured.y*.006/magnitude,z:measured.z*.006/magnitude}:measured;
      this.rootVelocity.x+=(bounded.x-this.rootVelocity.x)*.58;
      this.rootVelocity.y+=(bounded.y-this.rootVelocity.y)*.58;
      this.rootVelocity.z+=(bounded.z-this.rootVelocity.z)*.58;
    }
    if(Number.isFinite(gap)&&gap>55&&this.lastOutputPose){
      this.continuity.reacquisitions++;
      this.continuity.maxGapMs=Math.max(this.continuity.maxGapMs,gap);
      this.reacquireFrames=3;
    }
    if(this.reacquireFrames>0&&this.lastOutputPose){
      const amount=[.82,.62,.42][this.reacquireFrames-1]??.82;
      filtered={...filtered,
        rootPosition:{
          x:this.lastOutputPose.rootPosition.x+(filtered.rootPosition.x-this.lastOutputPose.rootPosition.x)*amount,
          y:this.lastOutputPose.rootPosition.y+(filtered.rootPosition.y-this.lastOutputPose.rootPosition.y)*amount,
          z:this.lastOutputPose.rootPosition.z+(filtered.rootPosition.z-this.lastOutputPose.rootPosition.z)*amount
        },
        rootScale:this.lastOutputPose.rootScale+(filtered.rootScale-this.lastOutputPose.rootScale)*amount,
        rootOrientation:quaternionSlerp(this.lastOutputPose.rootOrientation,filtered.rootOrientation,amount)
      };
      this.reacquireFrames--;
    }
    this.previousLivePose=filtered;
    this.lastPose=filtered;
    this.lastOutputPose=filtered;
    this.lastSeenAt = now;
    // Labels summarize observed 3D proximity; they never select a canned pose.
    const thumbContacts=pose.handTask?.contacts.filter(c=>c.a===0&&c.weight>.95)??[];
    let gesture=classifyRobotHandGesture(landmarks);
    if(thumbContacts.length>=2)gesture=thumbContacts.length===2?'CHỤM 3 NGÓN':thumbContacts.length===3?'CHỤM 4 NGÓN':'CHỤM 5 NGÓN';
    else if(thumbContacts.length===1&&thumbContacts[0].b>1)
      gesture=thumbContacts[0].b===2?'CÁI–GIỮA':thumbContacts[0].b===3?'CÁI–ÁP ÚT':'CÁI–ÚT';
    return {
      pose: this.lastPose,
      gesture: this.gestures.update(gesture),
      state: 'live'
    };
  }

  missing(now: number): RobotHandRealtimeResult {
    const gap=now-this.lastSeenAt;
    if (this.lastPose && gap <= this.lossGraceMs) {
      this.continuity.maxGapMs=Math.max(this.continuity.maxGapMs,gap);
      if(gap<=this.predictionHorizonMs){
        // Exponential braking carries the last trustworthy motion through a
        // short missed observation without the frozen-hand effect. The
        // displacement is bounded and never compounds between missing calls.
        const tau=88;
        const travel=tau*(1-Math.exp(-Math.max(0,gap)/tau));
        let delta={x:this.rootVelocity.x*travel,y:this.rootVelocity.y*travel,z:this.rootVelocity.z*travel};
        const magnitude=Math.hypot(delta.x,delta.y,delta.z);
        if(magnitude>.28)delta={x:delta.x*.28/magnitude,y:delta.y*.28/magnitude,z:delta.z*.28/magnitude};
        const predicted={...this.lastPose,rootPosition:{
          x:this.lastPose.rootPosition.x+delta.x,
          y:this.lastPose.rootPosition.y+delta.y,
          z:this.lastPose.rootPosition.z+delta.z
        }};
        this.lastOutputPose=predicted;
        this.continuity.predictedFrames++;
        return {pose:predicted,gesture:'HOLD',state:'predict'};
      }
      this.lastOutputPose=this.lastPose;
      this.continuity.heldFrames++;
      return { pose: this.lastPose, gesture: 'HOLD', state: 'hold' };
    }
    return { pose: null, gesture: 'REST', state: 'rest' };
  }

  continuitySnapshot():RobotHandContinuitySnapshot{return {...this.continuity};}

  reset(): void {
    this.filter.reset();
    this.gestures.reset();
    this.lastPose = null;
    this.lastOutputPose = null;
    this.previousLivePose = null;
    this.lastSeenAt = -Infinity;
    this.rootVelocity={x:0,y:0,z:0};
    this.reacquireFrames=0;
    this.continuity={predictedFrames:0,heldFrames:0,reacquisitions:0,maxGapMs:0};
  }
}

function percentile(values: number[], ratio: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * ratio) - 1)];
}

export interface RobotHandMetricSnapshot {
  pipeline: { samples: number; p50: number | null; p95: number | null };
  render: { samples: number; p50: number | null; p95: number | null };
  droppedVideoFrames: number;
}

export class RobotHandMetrics {
  private pipeline: number[] = [];
  private render: number[] = [];
  private dropped = 0;

  private add(target: number[], value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    target.push(value);
    if (target.length > 360) target.splice(0, target.length - 360);
  }

  addPipeline(value: number): void { this.add(this.pipeline, value); }
  addRender(value: number): void { this.add(this.render, value); }
  addDroppedVideoFrames(value: number): void { this.dropped += Math.max(0, Math.floor(value)); }

  snapshot(): RobotHandMetricSnapshot {
    return {
      pipeline: { samples: this.pipeline.length, p50: percentile(this.pipeline, .5), p95: percentile(this.pipeline, .95) },
      render: { samples: this.render.length, p50: percentile(this.render, .5), p95: percentile(this.render, .95) },
      droppedVideoFrames: this.dropped
    };
  }

  reset(): void {
    this.pipeline = [];
    this.render = [];
    this.dropped = 0;
  }
}
