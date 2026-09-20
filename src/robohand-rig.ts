import * as THREE from 'three/webgpu';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { ROBOT_HAND_SEGMENTS, ROBOT_PALM_DIRECTIONS, type RobotHandPose, type Vec3 } from './robohand-types';
import { retargetHand, HAND_TIPS, type HandTask } from './robohand-retarget';

export interface RobotHandRig {
  group: THREE.Group;
  setPose(pose: RobotHandPose | null): void;
  update(dtMs: number): void;
  dispose(): void;
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

export function createRobotHandRig(): RobotHandRig {
  const group=new THREE.Group();
  group.name='RoboHandRig';
  group.position.set(0,-.55,0);
  const geometries=new Set<THREE.BufferGeometry>();
  const titanium=new THREE.MeshStandardMaterial({color:0x798692,metalness:.85,roughness:.32});
  const ceramic=new THREE.MeshStandardMaterial({color:0xaeb8c0,metalness:.65,roughness:.29});
  const graphite=new THREE.MeshStandardMaterial({color:0x20272e,metalness:.65,roughness:.39});
  const rubber=new THREE.MeshStandardMaterial({color:0x151a20,metalness:.08,roughness:.78});
  const steel=new THREE.MeshStandardMaterial({color:0x748795,metalness:.85,roughness:.24});
  const indicator=new THREE.MeshStandardMaterial({color:0x7ce4ed,emissive:0x299ca9,emissiveIntensity:.65,roughness:.35});
  const materials=[titanium,ceramic,graphite,rubber,steel,indicator];
  function mesh(geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D=group): THREE.Mesh {
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
  block(group,rubber,[.32,.47,.105],[.15,.26,-.133]).rotation.z=-.26;
  block(group,rubber,[.22,.43,.10],[-.20,.30,-.129]).rotation.z=.22;
  block(group,graphite,[.14,.20,.045],[-.06,.38,.195]);
  block(group,indicator,[.015,.11,.012],[-.06,.40,.221]);
  const screwGeometry=new THREE.CylinderGeometry(.012,.012,.014,10);
  for (const [x,y] of [[-.20,.13],[.18,.14],[-.23,.45],[.20,.50]]) {
    const screw=mesh(screwGeometry,steel);
    screw.rotation.x=Math.PI/2; screw.position.set(x,y,.165);
  }
  // Narrow flexure wrist and split forearm fairing.
  block(group,rubber,[.36,.16,.24],[0,-.16,0]);
  for (const y of [-.12,-.17,-.22]) block(group,steel,[.37,.013,.25],[0,y,0]);
  mesh(plateGeometry([[-.18,-.25],[.18,-.25],[.24,-.68],[-.24,-.68]],.20,.035),titanium).name='wrist-fairing';
  block(group,graphite,[.095,.33,.026],[0,-.48,.14]);
  block(group,indicator,[.012,.075,.012],[0,-.37,.158]);

  const shellGeometry=phalangeGeometry(false), tipGeometry=phalangeGeometry(true);
  const bearingGeometry=new THREE.CylinderGeometry(1,1,1,24);
  const targetPoints=createRobotHandRestPoints().map(p=>new THREE.Vector3(p.x,p.y,p.z));
  const displayPoints=targetPoints.map(p=>p.clone());
  const links: {root: THREE.Group; index: number}[]=[];
  ROBOT_HAND_SEGMENTS.forEach((segment,index)=>{
    if (segment.section===0) return; // Metacarpals remain inside the palm.
    const root=new THREE.Group();
    root.name=segment.finger+'-phalange-'+segment.section;
    group.add(root); links.push({root,index});
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
  const targetPosition=new THREE.Vector3(0,-.55,0), targetQuaternion=new THREE.Quaternion();
  const direction=new THREE.Vector3(), desiredDirection=new THREE.Vector3();
  const previousDirection=new THREE.Vector3(), swing=new THREE.Quaternion(), identity=new THREE.Quaternion();
  const displayDirections=ROBOT_HAND_SEGMENTS.map(s=>new THREE.Vector3()
    .subVectors(displayPoints[s.child],displayPoints[s.parent]).normalize());
  let targetScale=1, tracking=false;
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
    if (pose) {
      targetPosition.set(pose.rootPosition.x*.28,-.55+pose.rootPosition.y*.22,pose.rootPosition.z*.18);
      targetQuaternion.set(pose.rootOrientation.x,pose.rootOrientation.y,pose.rootOrientation.z,pose.rootOrientation.w);
      targetScale=.88*pose.rootScale;
    } else {
      targetPosition.set(0,-.55,0); targetQuaternion.identity(); targetScale=1;
    }
  }
  function update(dtMs: number): void {
    // Display interpolation only; filtering stays in RobotHandPoseFilter.
    const response=1-Math.exp(-Math.min(50,Math.max(0,dtMs))/(tracking?14:190));
    group.position.lerp(targetPosition,response); group.quaternion.slerp(targetQuaternion,response);
    group.scale.setScalar(THREE.MathUtils.lerp(group.scale.x,targetScale,response));
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
  }
  update(0);
  return {group,setPose,update,dispose() {
    geometries.forEach(geometry=>geometry.dispose()); materials.forEach(material=>material.dispose());
  }};
}
