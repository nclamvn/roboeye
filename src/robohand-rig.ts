import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import URDFLoader, { type URDFRobot } from 'urdf-loader';
import { ROBOT_HAND_SEGMENTS, ROBOT_PALM_DIRECTIONS, type RobotHandPose, type Vec3 } from './robohand-types';
import { constrainHandAnatomy, retargetHand, HAND_TIPS, type HandTask } from './robohand-retarget';
import { computeSharpaJointTargets, type SharpaHandedness, type SharpaJointTargets } from './robohand-sharpa';

export interface RobotHandRig {
  group: THREE.Group;
  assetStatus(): 'fallback' | 'loading' | 'ready' | 'error';
  setEnvironment(texture: THREE.Texture | null): void;
  getGripTransform(kind:'phone'|'book',position:THREE.Vector3,quaternion:THREE.Quaternion,scale:THREE.Vector3):void;
  setPose(pose: RobotHandPose | null): void;
  update(dtMs: number): void;
  dispose(): void;
}

export interface RobotHandRigOptions {
  positionGainX?: number;
  positionGainY?: number;
  baseY?: number;
  accentColor?: number;
  modelHandedness?: SharpaHandedness;
}

const REST_DIRECTIONS: readonly Vec3[] = [
  { x: .66, y: .40, z: -.16 }, { x: .78, y: .56, z: -.14 }, { x: .82, y: .56, z: -.08 }, { x: .84, y: .54, z: 0 },
  { x: .39, y: .92, z: 0 }, { x: .05, y: 1, z: 0 }, { x: .02, y: 1, z: 0 }, { x: 0, y: 1, z: 0 },
  { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 }, { x: 0, y: 1, z: 0 },
  { x: -.38, y: .93, z: 0 }, { x: -.04, y: 1, z: 0 }, { x: -.02, y: 1, z: 0 }, { x: 0, y: 1, z: 0 },
  { x: -.67, y: .74, z: -.02 }, { x: -.11, y: .99, z: 0 }, { x: -.06, y: 1, z: 0 }, { x: -.03, y: 1, z: 0 }
];

function normalized(value: Vec3): THREE.Vector3 {
  return new THREE.Vector3(value.x, value.y, value.z).normalize();
}

export function createRobotHandRestPoints(): Vec3[] {
  const points = Array.from({ length: 21 }, () => ({ x: 0, y: 0, z: 0 }));
  ROBOT_HAND_SEGMENTS.forEach((segment, index) => {
    const direction = normalized(segment.section === 0 ? ROBOT_PALM_DIRECTIONS[segment.finger] : REST_DIRECTIONS[index]);
    const parent = points[segment.parent];
    points[segment.child] = {
      x: parent.x + direction.x * segment.length,
      y: parent.y + direction.y * segment.length,
      z: parent.z + direction.z * segment.length
    };
  });
  return points;
}


/** Closed tapered superellipse; local Y follows the phalange. */
function phalangeGeometry(tip: boolean): THREE.BufferGeometry {
  const profile = tip
    ? [[0,.62],[.055,.92],[.18,1],[.60,.91],[.81,.78],[.94,.48],[1,.015]]
    : [[0,.66],[.055,.94],[.17,1],[.77,.88],[.95,.79],[1,.56]];
  const vertices: number[] = [], indices: number[] = [];
  const sides = 24;
  for (const [y,r] of profile) for (let i=0; i<sides; i++) {
    const t=i/sides*Math.PI*2, c=Math.cos(t), s=Math.sin(t);
    vertices.push(Math.sign(c)*Math.abs(c)**.72*r,y,Math.sign(s)*Math.abs(s)**.72*r);
  }
  for (let row=0; row<profile.length-1; row++) for (let col=0; col<sides; col++) {
    const a=row*sides+col, b=row*sides+(col+1)%sides;
    indices.push(a,a+sides,b,b,a+sides,b+sides);
  }
  const bottom=vertices.length/3;
  vertices.push(0,0,0,0,1,0);
  for (let i=0; i<sides; i++) {
    const next=(i+1)%sides, last=(profile.length-1)*sides;
    indices.push(bottom,i,next,bottom+1,last+next,last+i);
  }
  const geometry=new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function plateGeometry(outline: readonly (readonly [number,number])[], depth: number, bevel: number): THREE.ExtrudeGeometry {
  const shape=new THREE.Shape();
  // Round the silhouette itself, rather than only beveling a polygonal slab.
  outline.forEach(([x,y],i)=>{
    const previous=outline[(i+outline.length-1)%outline.length], next=outline[(i+1)%outline.length];
    const before=Math.min(.065,Math.hypot(x-previous[0],y-previous[1])*.28);
    const after=Math.min(.065,Math.hypot(x-next[0],y-next[1])*.28);
    const a=new THREE.Vector2(previous[0]-x,previous[1]-y).normalize().multiplyScalar(before);
    const b=new THREE.Vector2(next[0]-x,next[1]-y).normalize().multiplyScalar(after);
    if(i===0)shape.moveTo(x+a.x,y+a.y);else shape.lineTo(x+a.x,y+a.y);
    shape.quadraticCurveTo(x,y,x+b.x,y+b.y);
  });
  shape.closePath();
  const geometry=new THREE.ExtrudeGeometry(shape,{
    depth,bevelEnabled:true,bevelSegments:4,bevelSize:bevel,bevelThickness:bevel,curveSegments:12
  });
  geometry.translate(0,0,-depth/2);
  return geometry;
}

export function createRobotHandRig(options:RobotHandRigOptions={}): RobotHandRig {
  const group=new THREE.Group();
  group.name='RoboHandRig';
  const proceduralRoot=new THREE.Group();
  proceduralRoot.name='RoboHandFallback';
  const officialRoot=new THREE.Group();
  officialRoot.name='SharpaWave';
  officialRoot.visible=false;
  group.add(proceduralRoot,officialRoot);
  const positionGainX=options.positionGainX??.28;
  const positionGainY=options.positionGainY??.22;
  const baseY=options.baseY??-.55;
  const accentColor=options.accentColor??0x7ce4ed;
  const modelHandedness=options.modelHandedness;
  group.position.set(0,baseY,0);
  const geometries=new Set<THREE.BufferGeometry>();
  const titanium=new THREE.MeshStandardMaterial({color:0x798692,metalness:.85,roughness:.32});
  const ceramic=new THREE.MeshStandardMaterial({color:0xaeb8c0,metalness:.65,roughness:.29});
  const graphite=new THREE.MeshStandardMaterial({color:0x20272e,metalness:.65,roughness:.39});
  const rubber=new THREE.MeshStandardMaterial({color:0x151a20,metalness:.08,roughness:.78});
  const steel=new THREE.MeshStandardMaterial({color:0x748795,metalness:.85,roughness:.24});
  const indicatorColor=new THREE.Color(accentColor);
  const indicator=new THREE.MeshStandardMaterial({color:indicatorColor,emissive:indicatorColor,
    emissiveIntensity:.72,roughness:.35});
  const waveCeramic=new THREE.MeshStandardMaterial({color:0xdde4e8,metalness:.52,roughness:.2});
  const waveTitanium=new THREE.MeshStandardMaterial({color:0x6d7b87,metalness:.92,roughness:.19});
  const waveElastomer=new THREE.MeshStandardMaterial({color:0x11171c,metalness:.05,roughness:.72});
  const materials=[titanium,ceramic,graphite,rubber,steel,indicator,waveCeramic,waveTitanium,waveElastomer];
  let environment:THREE.Texture|null=null;
  function applyEnvironment(material:THREE.MeshStandardMaterial):void{
    material.envMap=environment;material.envMapIntensity=.82;material.needsUpdate=true;
  }
  [titanium,ceramic,graphite,rubber,steel,indicator,waveCeramic,waveTitanium,waveElastomer]
    .forEach(applyEnvironment);
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D=proceduralRoot): THREE.Mesh {
    geometries.add(geometry);
    const object=new THREE.Mesh(geometry,material);
    object.castShadow=true; object.receiveShadow=true;
    parent.add(object);
    return object;
  }
  const rounded=new RoundedBoxGeometry(1,1,1,3,.16);
  function block(parent: THREE.Object3D, material: THREE.Material, scale: number[], position: number[]): THREE.Mesh {
    const object=mesh(rounded,material,parent);
    object.scale.set(scale[0],scale[1],scale[2]);
    object.position.set(position[0],position[1],position[2]);
    return object;
  }
  // The palm follows the MCP arch and narrows towards the carpus.
  mesh(plateGeometry([[-.23,-.075],[.23,-.075],[.32,.18],[.37,.43],[.34,.61],
    [.23,.68],[.04,.72],[-.19,.68],[-.39,.52],[-.43,.40],[-.28,.15]],.15,.045),graphite).name='contoured-palm';
  const backplate=mesh(plateGeometry([[-.19,0],[.18,0],[.25,.21],[.29,.48],[.21,.59],
    [.03,.64],[-.17,.60],[-.32,.46],[-.28,.27],[-.21,.10]],.045,.036),titanium);
  backplate.position.z=.116;
  const inlay=mesh(plateGeometry([[-.135,.08],[.10,.08],[.19,.30],[.16,.46],
    [.015,.54],[-.14,.49],[-.22,.30]],.012,.015),ceramic);
  inlay.position.z=.171;
  block(proceduralRoot,rubber,[.32,.47,.105],[.15,.26,-.133]).rotation.z=-.26;
  block(proceduralRoot,rubber,[.22,.43,.10],[-.20,.30,-.129]).rotation.z=.22;
  block(proceduralRoot,graphite,[.14,.20,.045],[-.06,.38,.195]);
  block(proceduralRoot,indicator,[.015,.11,.012],[-.06,.40,.221]);
  const screwGeometry=new THREE.CylinderGeometry(.012,.012,.014,10);
  for (const [x,y] of [[-.20,.13],[.18,.14],[-.23,.45],[.20,.50]]) {
    const screw=mesh(screwGeometry,steel);
    screw.rotation.x=Math.PI/2; screw.position.set(x,y,.165);
  }
  // Narrow flexure wrist and split forearm fairing.
  block(proceduralRoot,rubber,[.36,.16,.24],[0,-.16,0]);
  for (const y of [-.12,-.17,-.22]) block(proceduralRoot,steel,[.37,.013,.25],[0,y,0]);
  mesh(plateGeometry([[-.18,-.25],[.18,-.25],[.24,-.68],[-.24,-.68]],.20,.035),titanium).name='wrist-fairing';
  block(proceduralRoot,graphite,[.095,.33,.026],[0,-.48,.14]);
  block(proceduralRoot,indicator,[.012,.075,.012],[0,-.37,.158]);

  // Renderer-facing attachment sockets. They are children of the palm, so a
  // held object receives the exact smoothed world transform of the rig rather
  // than an approximation derived again from raw wrist coordinates.
  const gripSockets={phone:new THREE.Object3D(),book:new THREE.Object3D()};
  gripSockets.phone.name='phone-grip-socket';
  gripSockets.phone.position.set(0,.36,.205);
  gripSockets.book.name='book-grip-socket';
  gripSockets.book.position.set(0,.37,.18);
  group.add(gripSockets.phone,gripSockets.book);

  const shellGeometry=phalangeGeometry(false), tipGeometry=phalangeGeometry(true);
  const bearingGeometry=new THREE.CylinderGeometry(1,1,1,24);
  const targetPoints=createRobotHandRestPoints().map(p=>new THREE.Vector3(p.x,p.y,p.z));
  const displayPoints=targetPoints.map(p=>p.clone());
  const links: {root: THREE.Group; index: number}[]=[];
  ROBOT_HAND_SEGMENTS.forEach((segment,index)=>{
    if (segment.section===0) return; // Metacarpals remain inside the palm.
    const root=new THREE.Group();
    root.name=segment.finger+'-phalange-'+segment.section;
    proceduralRoot.add(root); links.push({root,index});
    const width=segment.finger==='thumb'?.108:segment.finger==='pinky'?.076:.092;
    const radius=width*(segment.section===3?.86:segment.section===2?.94:1);
    const tip=segment.section===3;
    const shell=mesh(tip?tipGeometry:shellGeometry,ceramic,root);
    shell.position.y=.045;
    shell.scale.set(radius,segment.length-.045,radius*.78);
    block(root,titanium,[radius*1.48,segment.length*(tip?.48:.63),.026],
      [0,segment.length*.49,radius*.77]);
    block(root,rubber,[radius*1.52,segment.length*.63,radius*.43],
      [0,segment.length*.52,-radius*.68]);
    const bearing=mesh(bearingGeometry,graphite,root);
    bearing.rotation.z=Math.PI/2; bearing.position.y=.027;
    bearing.scale.set(radius*.68,radius*1.87,radius*.68);
    for (const side of [-1,1]) {
      const axle=mesh(bearingGeometry,steel,root);
      axle.rotation.z=Math.PI/2; axle.position.set(side*radius*.95,.027,0);
      axle.scale.set(radius*.36,.009,radius*.36);
    }
  });
  let officialModel:URDFRobot|null=null;
  let loadStatus:'fallback'|'loading'|'ready'|'error'=modelHandedness?'loading':'fallback';
  let disposed=false;
  const targetJointValues:SharpaJointTargets={};
  const displayJointValues:SharpaJointTargets={};
  function configureOfficialModel(robot:URDFRobot):void{
    const replacedMaterials=new Set<THREE.Material>();
    robot.traverse(object=>{
      const candidate=object as THREE.Mesh;
      if(!candidate.isMesh)return;
      geometries.add(candidate.geometry);
      const original=Array.isArray(candidate.material)?candidate.material:[candidate.material];
      original.forEach(material=>replacedMaterials.add(material));
      const path:string[]=[];
      let cursor:THREE.Object3D|null=object;
      while(cursor){path.push(cursor.name.toLowerCase());cursor=cursor.parent;}
      const label=path.join(' ');
      candidate.material=label.includes('elastomer')?waveElastomer:
        label.includes('wrist')||label.includes('hand_c_mc')?waveTitanium:waveCeramic;
      candidate.castShadow=true;candidate.receiveShadow=true;
    });
    replacedMaterials.forEach(material=>material.dispose());
  }
  function beginOfficialLoad():void{
    if(!modelHandedness||typeof window==='undefined')return;
    const side=modelHandedness.toLowerCase();
    const base=import.meta.env.BASE_URL??'/';
    const sideRoot=new URL(`${base}assets/sharpa-wave/${side}/`,window.location.href).href.replace(/\/$/,'');
    const manager=new THREE.LoadingManager();
    const loader=new URDFLoader(manager);
    loader.parseVisual=true;loader.parseCollision=false;
    loader.packages={ [`${side}_sharpa_wave`]:sideRoot };
    let parsed=false;
    manager.onLoad=()=>{
      if(!parsed||disposed||!officialModel)return;
      officialRoot.visible=true;proceduralRoot.visible=false;loadStatus='ready';
      group.userData.assetStatus=loadStatus;
    };
    manager.onError=()=>{
      if(disposed)return;
      loadStatus='error';officialRoot.visible=false;proceduralRoot.visible=true;
      group.userData.assetStatus=loadStatus;
    };
    loader.load(`${sideRoot}/${side}_sharpa_wave_with_wrist.urdf`,robot=>{
      if(disposed){robot.traverse(object=>{const mesh=object as THREE.Mesh;if(mesh.isMesh)mesh.geometry.dispose();});return;}
      officialModel=robot;parsed=true;configureOfficialModel(robot);
      // Wave uses ROS axes (X forward, Y left, Z up). Map them to RoboEye's
      // canonical palm basis (X thumb-side, Y wrist-to-fingers, Z palm normal).
      const basis=new THREE.Matrix4().makeBasis(
        new THREE.Vector3(0,0,1),new THREE.Vector3(1,0,0),new THREE.Vector3(0,1,0));
      officialRoot.quaternion.setFromRotationMatrix(basis);
      officialRoot.scale.setScalar(5.35);
      officialRoot.position.set(0,-.16,0);
      officialRoot.add(robot);
      Object.entries(displayJointValues).forEach(([joint,value])=>robot.setJointValue(joint,value));
    },undefined,()=>{
      if(disposed)return;
      loadStatus='error';officialRoot.visible=false;proceduralRoot.visible=true;
      group.userData.assetStatus=loadStatus;
    });
  }
  group.userData.assetStatus=loadStatus;
  group.userData.modelName=modelHandedness?`Sharpa Wave ${modelHandedness}`:'procedural fallback';
  beginOfficialLoad();
  const targetPosition=new THREE.Vector3(0,baseY,0), targetQuaternion=new THREE.Quaternion();
  const leftHandCompensation=new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0,1,0),Math.PI);
  const direction=new THREE.Vector3(), desiredDirection=new THREE.Vector3();
  const previousDirection=new THREE.Vector3(), swing=new THREE.Quaternion(), identity=new THREE.Quaternion();
  const displayDirections=ROBOT_HAND_SEGMENTS.map(s=>new THREE.Vector3()
    .subVectors(displayPoints[s.child],displayPoints[s.parent]).normalize());
  let targetScale=1, tracking=false, targetChirality=modelHandedness==='Left'?-1:1;
  const targetFingerCurls=[0,0,0,0,0],displayFingerCurls=[0,0,0,0,0];
  let displayTask: HandTask | undefined;
  function setPose(pose: RobotHandPose|null): void {
    tracking=pose!=null;
    displayTask=pose?.handTask?.contacts.length ? {
      tips:HAND_TIPS.map(i=>({...pose.points[i]})),
      tipDirections:[3,7,11,15,19].map(i=>({...pose.directions[i]})),
      contacts:pose.handTask.contacts.map(c=>({...c}))
    } : undefined;
    const source=pose?.points??createRobotHandRestPoints();
    source.forEach((p,index)=>targetPoints[index].set(p.x,p.y,p.z));
    for(let index=0;index<5;index++)targetFingerCurls[index]=pose?.fingerCurls?.[index]??0;
    for(const name of Object.keys(targetJointValues))delete targetJointValues[name];
    if(pose&&modelHandedness)Object.assign(targetJointValues,computeSharpaJointTargets(pose,modelHandedness));
    if (pose) {
      targetPosition.set(pose.rootPosition.x*positionGainX,baseY+pose.rootPosition.y*positionGainY,pose.rootPosition.z*.18);
      targetQuaternion.set(pose.rootOrientation.x,pose.rootOrientation.y,pose.rootOrientation.z,pose.rootOrientation.w);
      targetChirality=modelHandedness==='Left'||(!modelHandedness&&pose.handedness==='Left')?-1:1;
      targetScale=.88*pose.rootScale;
    } else {
      targetPosition.set(0,baseY,0); targetQuaternion.identity(); targetScale=1;
      targetChirality=modelHandedness==='Left'?-1:1;
    }
  }
  function update(dtMs: number): void {
    // Display interpolation only; filtering stays in RobotHandPoseFilter.
    const response=1-Math.exp(-Math.min(50,Math.max(0,dtMs))/(tracking?14:190));
    group.position.lerp(targetPosition,response); group.quaternion.slerp(targetQuaternion,response);
    // Official left/right Wave assets are native meshes: the world transform
    // remains right-handed and never crosses through a negative scale. Only the
    // emergency procedural fallback receives the legacy reflection.
    const displayScale=THREE.MathUtils.lerp(group.scale.y,targetScale,response);
    group.scale.setScalar(displayScale);
    proceduralRoot.scale.set(targetChirality,1,1);
    proceduralRoot.quaternion.copy(targetChirality<0?leftHandCompensation:identity);
    for(let index=0;index<5;index++)displayFingerCurls[index]=THREE.MathUtils.lerp(
      displayFingerCurls[index],targetFingerCurls[index],response);
    displayPoints[0].set(0,0,0);
    ROBOT_HAND_SEGMENTS.forEach((segment,index)=>{
      if (segment.section===0) desiredDirection.copy(ROBOT_PALM_DIRECTIONS[segment.finger]).normalize();
      else desiredDirection.subVectors(targetPoints[segment.child],targetPoints[segment.parent]).normalize();
      // Interpolate directions on the sphere, then reconstruct fixed lengths.
      // Independently lerping joint positions collapses the chain during bends.
      swing.setFromUnitVectors(displayDirections[index],desiredDirection);
      swing.slerp(identity,1-response);
      displayDirections[index].applyQuaternion(swing).normalize();
      displayPoints[segment.child].copy(displayPoints[segment.parent])
        .addScaledVector(displayDirections[index],segment.length);
    });
    // Spherical interpolation is applied per segment for responsiveness. The
    // intermediate frame must still be projected as one articulated chain;
    // otherwise a valid open and valid fist pose can briefly pass through an
    // impossible PIP/DIP reversal on screen.
    const anatomical=constrainHandAnatomy(displayPoints,displayFingerCurls);
    anatomical.forEach((point,index)=>displayPoints[index].set(point.x,point.y,point.z));
    ROBOT_HAND_SEGMENTS.forEach((segment,index)=>displayDirections[index]
      .subVectors(displayPoints[segment.child],displayPoints[segment.parent]).normalize());
    if(displayTask){
      const constrained=retargetHand(displayPoints,displayTask,12);
      constrained.forEach((p,i)=>displayPoints[i].copy(p));
      ROBOT_HAND_SEGMENTS.forEach((s,i)=>displayDirections[i]
        .subVectors(displayPoints[s.child],displayPoints[s.parent]).normalize());
    }
    for (const {root,index} of links) {
      const segment=ROBOT_HAND_SEGMENTS[index];
      direction.subVectors(displayPoints[segment.child],displayPoints[segment.parent]);
      if (direction.lengthSq()<1e-10) continue;
      direction.normalize();
      // Parallel-transport shell roll instead of projecting a fixed X axis,
      // which flips 180 degrees when a finger crosses that axis.
      previousDirection.set(0,1,0).applyQuaternion(root.quaternion);
      swing.setFromUnitVectors(previousDirection,direction);
      root.quaternion.premultiply(swing).normalize();
      root.position.copy(displayPoints[segment.parent]);
    }
    if(officialModel){
      const jointResponse=1-Math.exp(-Math.min(50,Math.max(0,dtMs))/(tracking?26:150));
      for(const [joint,target] of Object.entries(targetJointValues)){
        const display=THREE.MathUtils.lerp(displayJointValues[joint]??0,target,jointResponse);
        displayJointValues[joint]=display;officialModel.setJointValue(joint,display);
      }
    }
  }
  update(0);
  return {group,setPose,update,assetStatus:()=>loadStatus,setEnvironment(texture){
    environment=texture;
    [titanium,ceramic,graphite,rubber,steel,indicator,waveCeramic,waveTitanium,waveElastomer]
      .forEach(applyEnvironment);
  },getGripTransform(kind,position,quaternion,scale) {
    group.updateWorldMatrix(true,false);
    gripSockets[kind].updateWorldMatrix(true,false);
    gripSockets[kind].getWorldPosition(position);
    gripSockets[kind].getWorldQuaternion(quaternion);
    gripSockets[kind].getWorldScale(scale);
    scale.set(Math.abs(scale.x),Math.abs(scale.y),Math.abs(scale.z));
  },dispose() {
    disposed=true;
    geometries.forEach(geometry=>geometry.dispose()); materials.forEach(material=>material.dispose());
  }};
}
