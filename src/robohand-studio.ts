import type {RobotHandPose, RobotHandedness} from './robohand-types';
import type {RobotHandGesture} from './robohand-gestures';

export type StudioPropKind='phone'|'book';
export type StudioPropAction='idle'|'held'|'swipe'|'page-turn'|'falling'|'resting';
export type StudioHandId='left'|'right';

export interface StudioHandIdentityObservation {
  handedness?:string|null;
  handednessScore?:number;
  wristX:number;
  wristY:number;
  palmSpan:number;
}

interface StudioIdentityTrack {
  x:number;
  y:number;
  vx:number;
  vy:number;
  palmSpan:number;
  at:number;
}

const studioHandIds:readonly StudioHandId[]=['left','right'];

function labelledIdentity(observation:Pick<StudioHandIdentityObservation,'handedness'>):StudioHandId|null {
  const normalized=observation.handedness?.toLowerCase();
  return normalized==='left'?'left':normalized==='right'?'right':null;
}

/** Resolve one operator's two physical hands to unique stable identities.
 * MediaPipe normally supplies opposite labels, but a brief duplicate label
 * must not make both render rigs acquire the same chirality. The x fallback is
 * expressed in the unmirrored camera bitmap; the proof video is mirrored only
 * by CSS for selfie presentation. */
export function resolveStudioHandIdentities(
  observations:readonly {handedness?:string|null;wristX:number}[]
):StudioHandId[] {
  const used=new Set<StudioHandId>();
  return observations.slice(0,2).map(observation=>{
    const normalized=observation.handedness?.toLowerCase();
    const labelled:StudioHandId|null=normalized==='left'?'left':normalized==='right'?'right':null;
    let id:StudioHandId=labelled??(observation.wristX<.5?'right':'left');
    if(used.has(id))id=id==='left'?'right':'left';
    used.add(id);
    return id;
  });
}

/** Observation-centric two-hand association.
 *
 * MediaPipe handedness is useful evidence, but it is not a durable track id:
 * the label can briefly duplicate or flip when hands cross or self-occlude.
 * This tracker predicts each wrist from its recent motion, evaluates both
 * possible two-hand assignments, then uses handedness only as a soft cost.
 * With at most two hands, exhaustive assignment is deterministic and cheaper
 * than pulling a general Hungarian/Kalman dependency into the render loop. */
export class StudioHandIdentityTracker {
  private readonly tracks=new Map<StudioHandId,StudioIdentityTrack>();

  assign(observations:readonly StudioHandIdentityObservation[],at:number):StudioHandId[] {
    const visible=observations.slice(0,2);
    this.expire(at);
    if(!visible.length)return [];

    let identities:StudioHandId[];
    if(this.tracks.size===0)identities=resolveStudioHandIdentities(visible);
    else if(visible.length===1){
      identities=[studioHandIds
        .map(id=>({id,cost:this.assignmentCost(id,visible[0],at)}))
        .sort((a,b)=>a.cost-b.cost||a.id.localeCompare(b.id))[0].id];
    }else{
      const direct:[StudioHandId,StudioHandId]=['left','right'];
      const swapped:[StudioHandId,StudioHandId]=['right','left'];
      const directCost=this.assignmentCost(direct[0],visible[0],at)+this.assignmentCost(direct[1],visible[1],at);
      const swappedCost=this.assignmentCost(swapped[0],visible[0],at)+this.assignmentCost(swapped[1],visible[1],at);
      identities=directCost<=swappedCost?direct:swapped;
    }

    visible.forEach((observation,index)=>this.updateTrack(identities[index],observation,at));
    return identities;
  }

  reset():void {this.tracks.clear();}

  private assignmentCost(id:StudioHandId,observation:StudioHandIdentityObservation,at:number):number {
    const track=this.tracks.get(id);
    const label=labelledIdentity(observation);
    const confidence=Math.max(0,Math.min(1,observation.handednessScore??.5));
    // Labels break a cold-start tie but cannot overpower an established
    // motion trajectory during a crossing.
    const labelCost=label&&label!==id?.008+.006*confidence:0;
    if(!track){
      const fallback=observation.wristX<.5?'right':'left';
      return .72+(fallback===id?0:.16)+labelCost;
    }
    const elapsed=Math.min(160,Math.max(0,at-track.at));
    const predictedX=track.x+track.vx*elapsed;
    const predictedY=track.y+track.vy*elapsed;
    const scale=Math.max(.12,(track.palmSpan+observation.palmSpan)*1.4);
    const motion=Math.hypot(observation.wristX-predictedX,observation.wristY-predictedY)/scale;
    const size=Math.abs(Math.log(Math.max(.02,observation.palmSpan)/Math.max(.02,track.palmSpan)))*.12;
    const stale=Math.max(0,at-track.at-180)/700;
    return motion+size+labelCost+stale;
  }

  private updateTrack(id:StudioHandId,observation:StudioHandIdentityObservation,at:number):void {
    const previous=this.tracks.get(id);
    let vx=0,vy=0;
    if(previous){
      const elapsed=Math.max(8,at-previous.at);
      const measuredX=Math.max(-.006,Math.min(.006,(observation.wristX-previous.x)/elapsed));
      const measuredY=Math.max(-.006,Math.min(.006,(observation.wristY-previous.y)/elapsed));
      vx=previous.vx+(measuredX-previous.vx)*.58;
      vy=previous.vy+(measuredY-previous.vy)*.58;
    }
    this.tracks.set(id,{x:observation.wristX,y:observation.wristY,vx,vy,
      palmSpan:Math.max(.02,observation.palmSpan),at});
  }

  private expire(at:number):void {
    for(const [id,track] of this.tracks)if(at-track.at>650)this.tracks.delete(id);
  }
}

export interface StudioHandInput {
  id:string;
  handedness:RobotHandedness;
  pose:RobotHandPose;
  gesture:RobotHandGesture;
  pinchStrength:number;
  gripStrength:number;
}

export interface StudioPropState {
  id:StudioPropKind;
  ownerId:string|null;
  position:{x:number;y:number};
  action:StudioPropAction;
  value:number;
}

export interface RoboHandStudioFrame {
  hands:StudioHandInput[];
  props:StudioPropState[];
  actionLabel:string;
  capturedAt:number|null;
}

interface HandMemory {x:number;y:number;gripping:boolean;openSince:number|null;at:number}

const clamp=(value:number,min=0,max=1)=>Math.max(min,Math.min(max,value));
const distance=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot(a.x-b.x,a.y-b.y);
const gripping=(hand:StudioHandInput)=>hand.pinchStrength>=.72||hand.gripStrength>=.78||hand.gesture==='FIST';
const fullyOpen=(hand:StudioHandInput)=>hand.gesture==='OPEN'&&hand.pinchStrength<=.24&&hand.gripStrength<=.32;
const activePointer=(hand:StudioHandInput)=>hand.gesture==='POINT'||hand.gesture==='PINCH';
const RELEASE_DWELL_MS=120;
const FLOOR_Y=-1.72;

/** Deterministic prop state. Coordinates use the pose solver's normalized root
 * space so the controller is renderer-independent and unit-testable. */
export class RoboHandStudioController {
  private props:StudioPropState[]=[
    {id:'phone',ownerId:null,position:{x:-1.05,y:-.18},action:'idle',value:0},
    {id:'book',ownerId:null,position:{x:1.05,y:-.18},action:'idle',value:0}
  ];
  private memory=new Map<string,HandMemory>();
  private velocityY=new Map<StudioPropKind,number>();
  private lastAt:number|null=null;
  private actionLabel='Sẵn sàng';
  private actionUntil=-Infinity;

  update(hands:StudioHandInput[],at:number):RoboHandStudioFrame {
    this.advanceDynamics(at);
    const ordered=[...hands].sort((a,b)=>a.id.localeCompare(b.id));
    // Read every edge/motion from the previous frame. Updating memory while
    // iterating hands made the later prop-interaction pass observe dx=0 and
    // silently disabled swipe/page-turn gestures.
    const previousMemory=new Map(this.memory);
    for(const hand of ordered){
      const position={x:hand.pose.rootPosition.x,y:hand.pose.rootPosition.y};
      const previous=previousMemory.get(hand.id);
      const isGrip=gripping(hand);
      const open=fullyOpen(hand);
      const openSince=open?(previous?.openSince??at):null;
      const owned=this.props.find(prop=>prop.ownerId===hand.id);
      if(owned){
        owned.position={...position};
        owned.action='held';
        this.velocityY.set(owned.id,0);
        // Ambiguous frames retain ownership. A deliberate, stable OPEN palm
        // is the sole release gesture, preventing a one-frame detector wobble
        // from dropping the object.
        if(open&&openSince!==null&&at-openSince>=RELEASE_DWELL_MS){
          owned.ownerId=null;
          owned.action='falling';
          this.velocityY.set(owned.id,0);
          this.signal(`Đã thả ${owned.id==='phone'?'điện thoại':'sách'}`,at);
        }
      }else if(isGrip&&!previous?.gripping){
        const target=this.props
          .filter(prop=>prop.ownerId===null&&distance(prop.position,position)<.62)
          .sort((a,b)=>distance(a.position,position)-distance(b.position,position))[0];
        if(target){
          target.ownerId=hand.id;
          target.position={...position};
          target.action='held';
          this.signal(`Đã cầm ${target.id==='phone'?'điện thoại':'sách'}`,at);
        }
      }
    }

    for(const prop of this.props){
      if(!prop.ownerId)continue;
      const operator=ordered.find(hand=>hand.id!==prop.ownerId&&activePointer(hand));
      if(!operator)continue;
      const current={x:operator.pose.rootPosition.x,y:operator.pose.rootPosition.y};
      const previous=previousMemory.get(operator.id);
      if(!previous||at-previous.at>180||distance(current,prop.position)>.9)continue;
      const dx=current.x-previous.x;
      if(Math.abs(dx)<.105)continue;
      if(prop.id==='phone'){
        prop.value=(prop.value+(dx>0?1:-1)+4)%4;
        prop.action='swipe';
        this.signal(`Vuốt điện thoại · màn ${prop.value+1}`,at);
      }else{
        prop.value=Math.max(0,prop.value+(dx<0?1:-1));
        prop.action='page-turn';
        this.signal(`Lật sách · trang ${prop.value+1}`,at);
      }
    }

    for(const hand of ordered){
      this.memory.set(hand.id,{
        x:hand.pose.rootPosition.x,
        y:hand.pose.rootPosition.y,
        gripping:gripping(hand),
        openSince:fullyOpen(hand)?(previousMemory.get(hand.id)?.openSince??at):null,
        at
      });
    }

    if(at>this.actionUntil){
      this.actionLabel=ordered.length===2?'Hai tay đang đồng bộ':ordered.length===1?'Một tay đang đồng bộ':'Đưa tay vào camera';
      for(const prop of this.props)if(prop.action==='swipe'||prop.action==='page-turn')prop.action=prop.ownerId?'held':'idle';
    }
    return {hands:ordered,props:this.props.map(prop=>({...prop,position:{...prop.position}})),
      actionLabel:this.actionLabel,capturedAt:ordered.length?Math.max(...ordered.map(hand=>hand.pose.capturedAt)):null};
  }

  missing(activeIds:Set<string>,at:number):RoboHandStudioFrame {
    for(const prop of this.props){
      if(prop.ownerId&&!activeIds.has(prop.ownerId)){
        prop.ownerId=null;prop.action='falling';this.velocityY.set(prop.id,0);
      }
    }
    for(const [id,memory] of this.memory)if(at-memory.at>500)this.memory.delete(id);
    return this.update([],at);
  }

  reset():void {
    this.props=[
      {id:'phone',ownerId:null,position:{x:-1.05,y:-.18},action:'idle',value:0},
      {id:'book',ownerId:null,position:{x:1.05,y:-.18},action:'idle',value:0}
    ];
    this.memory.clear();this.actionLabel='Sẵn sàng';this.actionUntil=-Infinity;
    this.velocityY.clear();this.lastAt=null;
  }

  private advanceDynamics(at:number):void {
    const dt=this.lastAt==null?0:Math.min(50,Math.max(0,at-this.lastAt))/1000;
    this.lastAt=at;
    if(dt===0)return;
    for(const prop of this.props){
      if(prop.action!=='falling')continue;
      const velocity=(this.velocityY.get(prop.id)??0)-3.8*dt;
      prop.position.y+=velocity*dt;
      if(prop.position.y<=FLOOR_Y){
        prop.position.y=FLOOR_Y;prop.action='resting';this.velocityY.set(prop.id,0);
      }else this.velocityY.set(prop.id,velocity);
    }
  }

  private signal(label:string,at:number):void {this.actionLabel=label;this.actionUntil=at+720;}
}

export function handIntent(points:{x:number;y:number;z:number}[]):{pinchStrength:number;gripStrength:number} {
  if(points.length!==21)return {pinchStrength:0,gripStrength:0};
  const d=(a:number,b:number)=>Math.hypot(points[a].x-points[b].x,points[a].y-points[b].y,points[a].z-points[b].z);
  const palm=Math.max(.001,d(5,17));
  const pinchStrength=clamp(1-d(4,8)/(palm*.62));
  const curls=[[8,6],[12,10],[16,14],[20,18]].map(([tip,pip])=>
    clamp(1-(d(tip,0)-d(pip,0))/(palm*.72)));
  return {pinchStrength,gripStrength:curls.reduce((sum,value)=>sum+value,0)/curls.length};
}
