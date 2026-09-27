// Toàn bộ tầng render: WebGPURenderer (tự fallback WebGL2), 4 chế độ hiển thị,
// point cloud TSL sample depth texture ngay trong vertex stage nên buffer tĩnh,
// mỗi frame chỉ upload texture. Nội suy vị trí điểm giữa 2 depth frame bằng uMix.

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { texture, uniform, uv, float, vec2, vec3, mix, floor as tslFloor, instanceIndex, varying } from 'three/tsl';
import { BevBuilder } from './bev';
import type { Mode } from '../types';
import type { DetBox, RelativeBox3D } from '../detection-types';
import { ROBOT_HAND_SEGMENTS, type RobotFingerCurls, type RobotHandPose, type RobotHandedness } from '../robohand-types';
import { createRobotHandRestPoints, createRobotHandRig } from '../robohand-rig';
import type {RoboHandStudioFrame,StudioPropKind} from '../robohand-studio';

// Ánh xạ relative depth (0..1, 1 = gần) sang khoảng cách tương đối qua inverse depth
const Z_NEAR = 0.5;
const Z_FAR = 6.0;

// Grid điểm: WebGPU 448x336 = 150.528 điểm (>=100k theo R4), WebGL 192x144 ≈ 27.6k (mục 9 PRD)
const GRID_WEBGPU: [number, number] = [448, 336];
const GRID_WEBGL: [number, number] = [192, 144];

type TexNode = ReturnType<typeof texture>;

function createShowcasePose(
  handedness: Exclude<RobotHandedness,'Unknown'>,
  rootX:number,
  curls:RobotFingerCurls
):RobotHandPose{
  const points=createRobotHandRestPoints();
  const directions=ROBOT_HAND_SEGMENTS.map(segment=>{
    const parent=points[segment.parent],child=points[segment.child];
    const magnitude=Math.hypot(child.x-parent.x,child.y-parent.y,child.z-parent.z)||1;
    return {x:(child.x-parent.x)/magnitude,y:(child.y-parent.y)/magnitude,z:(child.z-parent.z)/magnitude};
  });
  const orientation=new THREE.Quaternion().setFromEuler(new THREE.Euler(-.08,handedness==='Left'?-.14:.14,handedness==='Left'?-.06:.06));
  return {points,directions,fingerCurls:curls,rootPosition:{x:rootX,y:.22,z:0},
    rootOrientation:{x:orientation.x,y:orientation.y,z:orientation.z,w:orientation.w},rootScale:1.08,
    handedness,handednessScore:1,capturedAt:0,receivedAt:0};
}

function createRobotHandShowcaseFrame():RoboHandStudioFrame{
  return {
    hands:[
      {id:'left',handedness:'Left',pose:createShowcasePose('Left',-1.42,[.82,.66,.54,.58,.62]),gesture:'PINCH',pinchStrength:.9,gripStrength:.72},
      {id:'right',handedness:'Right',pose:createShowcasePose('Right',1.42,[1,1,1,1,1]),gesture:'FIST',pinchStrength:.42,gripStrength:1}
    ],
    props:[
      {id:'phone',ownerId:'left',position:{x:-1.05,y:-.18},action:'idle',value:0},
      {id:'book',ownerId:null,position:{x:1.05,y:-.18},action:'idle',value:0}
    ],
    actionLabel:'Sharpa Wave · xem thử không cần camera',capturedAt:null
  };
}

export interface SceneAPI {
  renderer: THREE.WebGPURenderer;
  isWebGPU: boolean;
  cloudCount: number;
  bev: BevBuilder;
  unprojectParams(): { tanH: number; aspect: number; invNear: number; invFar: number; signX: number };
  imageRectPx(): { x: number; y: number; w: number; h: number };
  attachVideo(video: HTMLVideoElement): void;
  setMode(mode: Mode): void;
  uploadColor(img: ImageData): void;
  pushDepth(depth: Uint8Array, w: number, h: number, intervalMs: number): void;
  setFov(deg: number): void;
  setPointScale(mult: number): void;
  setFrozen(frozen: boolean): void;
  setDetections(boxes: DetBox[]): void;
  setSelectedBox(idx: number): void;
  setRobotHandPose(pose: RobotHandPose | null): void;
  setRobotHandStudio(frame:RoboHandStudioFrame):void;
  consumeRobotHandPresentedFrame(): number | null;
  getDetections3D(): Array<RelativeBox3D | null>;
  resize(): void;
  render(dtMs: number): void;
  dispose(): void;
}

export async function createScene(canvas: HTMLCanvasElement, opts: { forceWebGL?: boolean } = {}): Promise<SceneAPI> {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: opts.forceWebGL === true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  await renderer.init();
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  const isWebGPU = (renderer.backend as { isWebGPUBackend?: boolean }).isWebGPUBackend === true;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0b0a);

  // ── Cameras ────────────────────────────────────────────────
  const orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  orthoCam.position.z = 2;
  const perspCam = new THREE.PerspectiveCamera(55, 1, 0.05, 40);
  perspCam.position.set(0, 0, 0.6);
  const controls = new OrbitControls(perspCam, canvas);
  controls.target.set(0, 0, -2);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 0.05;
  controls.maxDistance = 16;
  controls.update();
  const robotCam = new THREE.PerspectiveCamera(36, 1, 0.05, 30);
  robotCam.position.set(0, .16, 5.6);
  robotCam.lookAt(0, .16, 0);

  // ── RoboHand: native left/right Sharpa Wave URDF rigs ─────
  const robotStage = new THREE.Group();
  robotStage.visible = false;
  scene.add(robotStage);
  const robotRigs=[createRobotHandRig({positionGainX:.68,positionGainY:.38,accentColor:0x67e8f9,modelHandedness:'Left'}),
    createRobotHandRig({positionGainX:.68,positionGainY:.38,accentColor:0xa78bfa,modelHandedness:'Right'})];
  robotRigs.forEach(rig=>{rig.group.visible=false;robotStage.add(rig.group);});
  let robotEnvironment: THREE.RenderTarget | null = null;
  function prepareRobotEnvironment(): void {
    if (robotEnvironment) return;
    const room = new RoomEnvironment();
    const generator = new THREE.PMREMGenerator(renderer);
    robotEnvironment = generator.fromScene(room, .04, .1, 100, { size: 128 });
    // Keep the environment scoped to hand materials. The rig also applies it
    // to Wave meshes that finish loading after this one-time preparation.
    robotRigs.forEach(rig=>rig.setEnvironment(robotEnvironment!.texture));
    generator.dispose();
    room.dispose();
  }
  const robotKey = new THREE.DirectionalLight(0xf3f6ff, 3.2);
  robotKey.position.set(-2.8, 4.5, 4);
  robotKey.castShadow = true;
  robotKey.shadow.mapSize.set(1024, 1024);
  robotStage.add(robotKey);
  const robotFill = new THREE.DirectionalLight(0xc5d8ee, 1.8);
  robotFill.position.set(3.5, 1.2, 2.2);
  robotStage.add(robotFill);
  const robotRim = new THREE.PointLight(0xb7ecff, 12, 9, 2);
  robotRim.position.set(-2.4, 1.8, -1.7);
  robotStage.add(robotRim);
  const robotAmbient = new THREE.HemisphereLight(0xe0e7ef, 0x20242a, 2.0);
  robotStage.add(robotAmbient);
  const robotFloor = new THREE.Mesh(
    new THREE.CircleGeometry(2.15, 64),
    new THREE.MeshStandardMaterial({ color: 0x101617, metalness: .72, roughness: .34 })
  );
  robotFloor.rotation.x = -Math.PI / 2;
  robotFloor.position.y = -1.27;
  robotFloor.receiveShadow = true;
  robotStage.add(robotFloor);
  const robotHalo = new THREE.Mesh(
    new THREE.TorusGeometry(1.64, .008, 8, 96),
    new THREE.MeshBasicMaterial({ color: 0x799ba9, transparent: true, opacity: .25 })
  );
  robotHalo.rotation.x = Math.PI / 2;
  robotHalo.position.y = -1.25;
  robotStage.add(robotHalo);

  // Recognizable offline props. Their state is driven by RoboHandStudioController;
  // geometry stays deliberately lightweight so tracking keeps the GPU budget.
  const propGeometries:THREE.BufferGeometry[]=[];
  const propMaterials:THREE.Material[]=[];
  const propGroup=new THREE.Group();robotStage.add(propGroup);
  function propMaterial(parameters:THREE.MeshStandardMaterialParameters):THREE.MeshStandardMaterial{
    const material=new THREE.MeshStandardMaterial(parameters);
    // Props and hand shells share the real depth buffer. Keeping both writes
    // enabled lets the renderer naturally expose the thumb in front of a
    // phone while hiding the palm/fingers that are physically behind it.
    material.depthTest=true;material.depthWrite=true;material.transparent=false;
    propMaterials.push(material);return material;
  }
  function propMesh(geometry:THREE.BufferGeometry,material:THREE.Material,parent:THREE.Object3D):THREE.Mesh{
    propGeometries.push(geometry);const object=new THREE.Mesh(geometry,material);object.castShadow=true;object.receiveShadow=true;parent.add(object);return object;
  }
  const phone=new THREE.Group();phone.name='studio-phone';propGroup.add(phone);
  propMesh(new RoundedBoxGeometry(.46,.86,.075,4,.055),propMaterial({color:0x161b22,metalness:.82,roughness:.24}),phone);
  const phoneScreen=propMesh(new RoundedBoxGeometry(.405,.75,.012,3,.034),propMaterial({color:0x16354a,emissive:0x0b314d,emissiveIntensity:1.3,metalness:.08,roughness:.2}),phone);
  phoneScreen.position.z=.048;
  const phoneBar=propMesh(new RoundedBoxGeometry(.20,.012,.008,2,.006),propMaterial({color:0xb8f3ff,emissive:0x4fd6ff,emissiveIntensity:1.5}),phone);
  phoneBar.position.set(0,.29,.06);
  phone.position.set(-1.10,-.62,.34);phone.rotation.z=-.12;phone.scale.setScalar(.84);
  const book=new THREE.Group();book.name='studio-book';propGroup.add(book);
  const bookCoverMat=propMaterial({color:0x36536a,metalness:.16,roughness:.58});
  const paperMat=propMaterial({color:0xe9e5d9,roughness:.88});
  const leftCover=propMesh(new RoundedBoxGeometry(.46,.72,.055,3,.025),bookCoverMat,book);leftCover.position.x=-.235;
  const rightCover=propMesh(new RoundedBoxGeometry(.46,.72,.055,3,.025),bookCoverMat,book);rightCover.position.x=.235;
  const leftPages=propMesh(new RoundedBoxGeometry(.42,.66,.065,2,.018),paperMat,book);leftPages.position.set(-.22,0,.045);
  const rightPages=propMesh(new RoundedBoxGeometry(.42,.66,.065,2,.018),paperMat,book);rightPages.position.set(.22,0,.045);
  const pageLeaf=new THREE.Group();pageLeaf.position.set(0,0,.09);book.add(pageLeaf);
  const leaf=propMesh(new THREE.PlaneGeometry(.42,.64),paperMat,pageLeaf);leaf.position.x=.21;
  book.position.set(1.10,-.62,.28);book.rotation.set(-.18,.08,.1);book.scale.setScalar(.82);
  const propObjects:Record<StudioPropKind,THREE.Group>={phone,book};
  const propHome={phone:new THREE.Vector3(-1.10,-.62,.34),book:new THREE.Vector3(1.10,-.62,.28)};
  const propFloor={phone:-.94,book:-.95};
  const propMotion:Record<StudioPropKind,{falling:boolean;velocityY:number;spin:number}>={
    phone:{falling:false,velocityY:0,spin:0},book:{falling:false,velocityY:0,spin:0}
  };
  const gripPosition=new THREE.Vector3(),gripQuaternion=new THREE.Quaternion(),gripScale=new THREE.Vector3();
  const localGripPosition=new THREE.Vector3(),localGripQuaternion=new THREE.Quaternion();
  const propParentQuaternion=new THREE.Quaternion(),propParentScale=new THREE.Vector3();
  const desiredScale=new THREE.Vector3();
  let studioFrame:RoboHandStudioFrame|null=null;
  let rigOwnerIds:(string|null)[]=[null,null];
  let pageTurn=0;

  // ── Uniforms dùng chung ────────────────────────────────────
  const uMix = uniform(1);
  const uTanH = uniform(Math.tan((60 * Math.PI) / 360)); // FOV ngang 60° giả định
  const uAspect = uniform(16 / 9);
  const uSignX = uniform(-1); // mirror kiểu selfie
  const uInvNear = uniform(1 / Z_NEAR);
  const uInvFar = uniform(1 / Z_FAR);
  const uPointScale = uniform(1);

  // ── Textures: depth prev/curr + color, tất cả row 0 = mép trên ảnh ──
  let capW = 4;
  let capH = 4;
  let depthPrevTex = makeDepthTexture(capW, capH);
  let depthCurrTex = makeDepthTexture(capW, capH);
  let colorTex = makeColorTexture(capW, capH);

  const depthPrevNodes: TexNode[] = [];
  const depthCurrNodes: TexNode[] = [];
  const colorNodes: TexNode[] = [];

  function makeDepthTexture(w: number, h: number): THREE.DataTexture {
    const t = new THREE.DataTexture(new Uint8Array(w * h), w, h, THREE.RedFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }

  function makeColorTexture(w: number, h: number): THREE.DataTexture {
    const t = new THREE.DataTexture(new Uint8Array(w * h * 4), w, h, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = false;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }

  // TSL node typings quá hẹp cho VaryingNode nên nhận any ở đây, an toàn vì chỉ là uv node
  /* eslint-disable @typescript-eslint/no-explicit-any */
  function sampleDepthPrev(uvNode: any): TexNode {
    const n = texture(depthPrevTex, uvNode);
    depthPrevNodes.push(n);
    return n;
  }
  function sampleDepthCurr(uvNode: any): TexNode {
    const n = texture(depthCurrTex, uvNode);
    depthCurrNodes.push(n);
    return n;
  }
  function sampleColor(uvNode: any): TexNode {
    const n = texture(colorTex, uvNode);
    colorNodes.push(n);
    return n;
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */

  // ── Chế độ RGB: quad video live ────────────────────────────
  let videoTex: THREE.VideoTexture | null = null;
  const rgbMat = new THREE.MeshBasicNodeMaterial();
  const rgbPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), rgbMat);
  rgbPlane.visible = false;
  scene.add(rgbPlane);

  // ── Chế độ Depth: quad grayscale, gần sáng xa tối ──────────
  // Plane UV: v=1 mép trên; depth texture: v=0 hàng đầu = mép trên ảnh → sample y = 1-v
  const depthUv = vec2(uv().x.oneMinus(), uv().y.oneMinus()); // mirror x cho khớp RGB selfie
  const dMixPlane = mix(sampleDepthPrev(depthUv).r, sampleDepthCurr(depthUv).r, uMix);
  const depthMat = new THREE.MeshBasicNodeMaterial();
  depthMat.colorNode = vec3(dMixPlane);
  const depthPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), depthMat);
  depthPlane.visible = false;
  scene.add(depthPlane);

  // ── Chế độ Point Cloud: sprite instanced, positionNode từ depth ──
  const [gw, gh] = isWebGPU ? GRID_WEBGPU : GRID_WEBGL;
  const cloudCount = gw * gh;

  const fi = float(instanceIndex);
  const iy = tslFloor(fi.div(gw));
  const ix = fi.sub(iy.mul(gw));
  const cu = ix.add(0.5).div(gw);
  const cv = iy.add(0.5).div(gh); // cv=0 → hàng đầu depth = mép trên ảnh
  const cloudUv = vec2(cu, cv);

  const dCloud = mix(sampleDepthPrev(cloudUv).r, sampleDepthCurr(cloudUv).r, uMix);
  const zView = float(1).div(mix(uInvFar, uInvNear, dCloud));
  const px = cu.sub(0.5).mul(2).mul(uTanH).mul(zView).mul(uSignX);
  const py = float(0.5).sub(cv).mul(2).mul(uTanH).div(uAspect).mul(zView);

  const cloudMat = new THREE.SpriteNodeMaterial();
  cloudMat.positionNode = vec3(px, py, zView.negate());
  cloudMat.colorNode = sampleColor(varying(cloudUv));
  cloudMat.scaleNode = uPointScale.mul(zView);
  cloudMat.depthWrite = true;

  const cloud = new THREE.Sprite(cloudMat);
  cloud.count = cloudCount;
  cloud.frustumCulled = false;
  cloud.visible = false;
  scene.add(cloud);

  // Trục sàn mờ giúp định hướng khi bay quanh
  const gridHelper = new THREE.GridHelper(8, 16, 0x2a2a2a, 0x1d1d1c);
  gridHelper.position.y = -1.4;
  gridHelper.visible = false;
  scene.add(gridHelper);

  // ── Fusion: 3D box wireframe nâng từ detection + depth (engine v2) ──
  const boxGroup = new THREE.Group();
  boxGroup.visible = false;
  scene.add(boxGroup);
  const boxMat = new THREE.LineBasicMaterial({ color: 0x8c8c8c }); // vật thường: xám
  const boxMatSel = new THREE.LineBasicMaterial({ color: 0xffffff }); // vật đang chọn: trắng
  let detBoxes: DetBox[] = [];
  let selectedBox = -1;
  // Tham số 3D box (không gian view, tỷ lệ tương đối) để export
  const det3d: Array<{ cx: number; cy: number; cz: number; hx: number; hy: number; hz: number } | null> = [];

  // Nâng một điểm ảnh (u,vTop raw, 0..1) + depth d → toạ độ world khớp point cloud
  function liftPoint(u: number, vTop: number, d: number): [number, number, number] {
    const tanH = uTanH.value as number;
    const aspect = uAspect.value as number;
    const invNear = uInvNear.value as number;
    const invFar = uInvFar.value as number;
    const signX = uSignX.value as number;
    const z = 1 / (invFar + (invNear - invFar) * d);
    const x = (u - 0.5) * 2 * tanH * z * signX;
    const y = (0.5 - vTop) * 2 * tanH * z / aspect;
    return [x, y, -z];
  }

  function rebuildBoxes() {
    boxGroup.clear();
    det3d.length = 0;
    const data = depthCurrTex.image.data as Uint8Array;
    const dw = depthCurrTex.image.width;
    const dh = depthCurrTex.image.height;
    if (dw < 2 || dh < 2) return;
    detBoxes.forEach((b, idx) => {
      // Lấy mẫu depth trong box, dùng percentile để bỏ nền xa lọt vào khung
      const samples: number[] = [];
      const SN = 9;
      for (let iy = 1; iy < SN; iy++) {
        for (let ix = 1; ix < SN; ix++) {
          const u = b.x0 + (b.x1 - b.x0) * (ix / SN);
          const v = b.y0 + (b.y1 - b.y0) * (iy / SN);
          const px = Math.min(dw - 1, Math.max(0, Math.round(u * dw)));
          const py = Math.min(dh - 1, Math.max(0, Math.round(v * dh)));
          samples.push(data[py * dw + px] / 255);
        }
      }
      if (samples.length === 0) {
        det3d.push(null);
        return;
      }
      samples.sort((a, c) => a - c);
      // vật thường gần hơn nền: lấy dải depth gần (percentile cao vì 1 = gần)
      const dNear = samples[Math.floor(samples.length * 0.85)];
      const dFar = samples[Math.floor(samples.length * 0.5)];
      if (dNear <= 0.02) {
        det3d.push(null);
        return;
      }
      // 8 góc: 4 góc box ở dNear và dFar
      const corners: Array<[number, number, number]> = [];
      for (const d of [dNear, dFar]) {
        corners.push(liftPoint(b.x0, b.y0, d));
        corners.push(liftPoint(b.x1, b.y0, d));
        corners.push(liftPoint(b.x1, b.y1, d));
        corners.push(liftPoint(b.x0, b.y1, d));
      }
      const geo = boxWireframe(corners);
      boxGroup.add(new THREE.LineSegments(geo, idx === selectedBox ? boxMatSel : boxMat));
      // AABB cho export
      let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      for (const c of corners) {
        minX = Math.min(minX, c[0]); maxX = Math.max(maxX, c[0]);
        minY = Math.min(minY, c[1]); maxY = Math.max(maxY, c[1]);
        minZ = Math.min(minZ, c[2]); maxZ = Math.max(maxZ, c[2]);
      }
      det3d.push({
        cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, cz: (minZ + maxZ) / 2,
        hx: (maxX - minX) / 2, hy: (maxY - minY) / 2, hz: (maxZ - minZ) / 2
      });
    });
  }

  function boxWireframe(c: Array<[number, number, number]>): THREE.BufferGeometry {
    // c[0..3] mặt gần, c[4..7] mặt xa, thứ tự vòng
    const edges = [
      [0, 1], [1, 2], [2, 3], [3, 0],
      [4, 5], [5, 6], [6, 7], [7, 4],
      [0, 4], [1, 5], [2, 6], [3, 7]
    ];
    const pos = new Float32Array(edges.length * 2 * 3);
    let k = 0;
    for (const [a, b] of edges) {
      pos[k++] = c[a][0]; pos[k++] = c[a][1]; pos[k++] = c[a][2];
      pos[k++] = c[b][0]; pos[k++] = c[b][1]; pos[k++] = c[b][2];
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    return g;
  }

  // ── Chế độ BEV: quad canvas texture ────────────────────────
  const bev = new BevBuilder();
  const bevTex = new THREE.CanvasTexture(bev.canvas);
  bevTex.colorSpace = THREE.SRGBColorSpace;
  const bevMat = new THREE.MeshBasicNodeMaterial();
  bevMat.colorNode = texture(bevTex, uv());
  const bevPlane = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), bevMat);
  bevPlane.visible = false;
  scene.add(bevPlane);

  // ── State ──────────────────────────────────────────────────
  let mode: Mode = 'rgb';
  let frozen = false;
  let inferInterval = 200; // ms, EMA
  let viewW = 1;
  let viewH = 1;
  let pendingRobotCapturedAt: number | null = null;
  let presentedRobotCapturedAt: number | null = null;

  function applyRobotHandFrame(frame:RoboHandStudioFrame):void{
    studioFrame=frame;
    robotRigs.forEach((rig,index)=>{
      const hand=frame.hands.find(candidate=>candidate.id===(index===0?'left':'right'));
      rigOwnerIds[index]=hand?.id??null;
      rig.group.visible=Boolean(hand);rig.setPose(hand?.pose??null);
    });
    if(frame.capturedAt!=null)pendingRobotCapturedAt=frame.capturedAt;
  }

  // Click lên BEV plane để đặt đích cho robot ảo (TIP-06)
  canvas.addEventListener('click', (e) => {
    if (mode !== 'bev') return;
    const s = bevPlane.scale.x; // plane vuông nên scale x = y
    if (s <= 0) return;
    const a = viewW / Math.max(1, viewH);
    const xo = ((e.offsetX / viewW) * 2 - 1) * a;
    const yo = 1 - (e.offsetY / viewH) * 2;
    const u = (xo + s) / (2 * s);
    const vTop = (s - yo) / (2 * s);
    if (u >= 0 && u <= 1 && vTop >= 0 && vTop <= 1) bev.setGoalFromUv(u, vTop);
  });

  function fitPlane(plane: THREE.Mesh, imgAspect: number) {
    const viewAspect = viewW / Math.max(1, viewH);
    // Plane gốc 2x2. Contain-fit vào ortho frustum [-A..A] x [-1..1]
    let sx = imgAspect;
    let sy = 1;
    if (sx > viewAspect) {
      const k = viewAspect / sx;
      sx *= k;
      sy *= k;
    }
    plane.scale.set(sx, sy, 1);
  }

  function refitPlanes() {
    const imgAspect = uAspect.value as number;
    fitPlane(rgbPlane, imgAspect);
    fitPlane(depthPlane, imgAspect);
    fitPlane(bevPlane, 1);
  }

  const api: SceneAPI = {
    renderer,
    isWebGPU,
    cloudCount,
    bev,

    unprojectParams() {
      return {
        tanH: uTanH.value as number,
        aspect: uAspect.value as number,
        invNear: uInvNear.value as number,
        invFar: uInvFar.value as number,
        signX: uSignX.value as number
      };
    },

    imageRectPx() {
      // Vùng ảnh RGB/Depth hiển thị trên màn (CSS px), khớp contain-fit của ortho plane
      const a = viewW / Math.max(1, viewH);
      const sx = rgbPlane.scale.x;
      const sy = rgbPlane.scale.y;
      return {
        x: ((a - sx) / (2 * a)) * viewW,
        y: ((1 - sy) / 2) * viewH,
        w: (sx / a) * viewW,
        h: sy * viewH
      };
    },

    attachVideo(video: HTMLVideoElement) {
      videoTex = new THREE.VideoTexture(video);
      videoTex.colorSpace = THREE.SRGBColorSpace;
      // Mirror selfie: sample u' = 1-u
      rgbMat.colorNode = texture(videoTex, vec2(uv().x.oneMinus(), uv().y));
      rgbMat.needsUpdate = true;
      const va = video.videoWidth / Math.max(1, video.videoHeight);
      if (Number.isFinite(va) && va > 0) uAspect.value = va;
      refitPlanes();
    },

    setMode(m: Mode) {
      mode = m;
      rgbPlane.visible = m === 'rgb';
      depthPlane.visible = m === 'depth';
      cloud.visible = m === 'cloud';
      gridHelper.visible = m === 'cloud';
      boxGroup.visible = m === 'cloud';
      bevPlane.visible = m === 'bev';
      robotStage.visible = m === 'robohand';
      if (m === 'robohand') {
        prepareRobotEnvironment();
        if(!studioFrame?.hands.length)applyRobotHandFrame(createRobotHandShowcaseFrame());
      }
      controls.enabled = m === 'cloud';
    },

    setRobotHandPose(pose) {
      const index=pose?.handedness==='Right'?1:0;
      robotRigs.forEach((rig,rigIndex)=>{
        const selected=pose!=null&&rigIndex===index;
        rig.group.visible=selected;rig.setPose(selected?pose:null);
      });
      if (pose) pendingRobotCapturedAt = pose.capturedAt;
    },

    setRobotHandStudio(frame){
      applyRobotHandFrame(frame);
    },

    consumeRobotHandPresentedFrame() {
      const value = presentedRobotCapturedAt;
      presentedRobotCapturedAt = null;
      return value;
    },

    setDetections(boxes: DetBox[]) {
      detBoxes = boxes;
      rebuildBoxes();
    },

    setSelectedBox(idx: number) {
      selectedBox = idx;
      rebuildBoxes();
    },

    getDetections3D() {
      return det3d;
    },

    uploadColor(img: ImageData) {
      if (frozen) return;
      if (img.width !== colorTex.image.width || img.height !== colorTex.image.height) {
        colorTex.dispose();
        colorTex = makeColorTexture(img.width, img.height);
        for (const n of colorNodes) n.value = colorTex;
      }
      (colorTex.image.data as Uint8Array).set(new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength));
      colorTex.needsUpdate = true;
    },

    pushDepth(depth: Uint8Array, w: number, h: number, intervalMs: number) {
      if (frozen) return;
      inferInterval = inferInterval * 0.7 + intervalMs * 0.3;
      if (w !== depthCurrTex.image.width || h !== depthCurrTex.image.height) {
        depthPrevTex.dispose();
        depthCurrTex.dispose();
        depthPrevTex = makeDepthTexture(w, h);
        depthCurrTex = makeDepthTexture(w, h);
        for (const n of depthPrevNodes) n.value = depthPrevTex;
        for (const n of depthCurrNodes) n.value = depthCurrTex;
        (depthPrevTex.image.data as Uint8Array).set(depth);
        depthPrevTex.needsUpdate = true;
      } else {
        // prev ← curr, curr ← mới, reset mix để nội suy mượt
        (depthPrevTex.image.data as Uint8Array).set(depthCurrTex.image.data as Uint8Array);
        depthPrevTex.needsUpdate = true;
      }
      (depthCurrTex.image.data as Uint8Array).set(depth);
      depthCurrTex.needsUpdate = true;
      uMix.value = 0;
      // BEV cập nhật theo depth mới nhất
      bev.update(depth, w, h, api.unprojectParams());
      bevTex.needsUpdate = true;
    },

    setFov(deg: number) {
      uTanH.value = Math.tan((deg * Math.PI) / 360);
    },

    setPointScale(mult: number) {
      // Khoảng cách điểm lân cận ≈ 2*tanH*z/gw → sprite hơi to hơn khoảng cách để phủ kín
      const base = ((2 * (uTanH.value as number)) / gw) * 1.7;
      uPointScale.value = base * mult;
    },

    setFrozen(f: boolean) {
      frozen = f;
    },

    resize() {
      const parent = canvas.parentElement;
      if (!parent) return;
      viewW = parent.clientWidth;
      viewH = parent.clientHeight;
      renderer.setSize(viewW, viewH, false);
      const a = viewW / Math.max(1, viewH);
      orthoCam.left = -a;
      orthoCam.right = a;
      orthoCam.updateProjectionMatrix();
      perspCam.aspect = a;
      perspCam.updateProjectionMatrix();
      robotCam.aspect = a;
      // Keep the thumb and wrist in view on narrow camera-stage layouts.
      robotCam.position.z = Math.max(5.6, 3.8 / Math.max(.25, a));
      robotCam.updateProjectionMatrix();
      refitPlanes();
    },

    render(dtMs: number) {
      if (!frozen) {
        uMix.value = Math.min(1, (uMix.value as number) + dtMs / Math.max(30, inferInterval));
      }
      if (mode === 'bev') {
        // robot ảo di chuyển mượt theo render frame, độc lập nhịp inference
        bev.compose(Math.min(dtMs, 100) / 1000);
        bevTex.needsUpdate = true;
      }
      if (mode === 'cloud') controls.update();
      if (mode === 'robohand') {
        robotRigs.forEach(rig=>rig.update(dtMs));
        robotStage.updateMatrixWorld(true);
        propGroup.updateWorldMatrix(true,false);
        robotHalo.rotation.z += Math.min(dtMs, 50) * .00016;
        const response=1-Math.exp(-Math.min(dtMs,50)/55);
        for(const prop of studioFrame?.props??[]){
          const object=propObjects[prop.id];
          const owner=studioFrame?.hands.find(hand=>hand.id===prop.ownerId);
          if(owner){
            const rigIndex=rigOwnerIds.indexOf(owner.id);
            const rig=rigIndex>=0?robotRigs[rigIndex]:null;
            if(rig){
              rig.getGripTransform(prop.id,gripPosition,gripQuaternion,gripScale);
              localGripPosition.copy(gripPosition);propGroup.worldToLocal(localGripPosition);
              propGroup.getWorldQuaternion(propParentQuaternion).invert();
              localGripQuaternion.copy(propParentQuaternion).multiply(gripQuaternion);
              propGroup.getWorldScale(propParentScale);
              desiredScale.copy(gripScale).divide(propParentScale)
                .multiplyScalar(prop.id==='phone'?.76:.69);
              object.position.lerp(localGripPosition,response);
              object.quaternion.slerp(localGripQuaternion,response);
              object.scale.lerp(desiredScale,response);
            }
            const motion=propMotion[prop.id];motion.falling=false;motion.velocityY=0;motion.spin=0;
          }else if(prop.action==='falling'||propMotion[prop.id].falling){
            const motion=propMotion[prop.id];
            if(!motion.falling){motion.falling=true;motion.velocityY=0;motion.spin=prop.id==='phone'?2.1:-1.65;}
            const seconds=Math.min(dtMs,50)/1000;
            motion.velocityY-=3.9*seconds;
            object.position.y+=motion.velocityY*seconds;
            object.rotation.x+=motion.spin*seconds;
            object.rotation.z+=motion.spin*.37*seconds;
            if(object.position.y<=propFloor[prop.id]){
              object.position.y=propFloor[prop.id];motion.falling=false;motion.velocityY=0;
            }
          }else if(!Number.isFinite(object.position.x))object.position.copy(propHome[prop.id]);
          if(prop.id==='phone'&&prop.action==='swipe'){
            const hue=[0x16354a,0x3d285d,0x17493e,0x533029][prop.value%4];
            (phoneScreen.material as THREE.MeshStandardMaterial).color.setHex(hue);
            (phoneScreen.material as THREE.MeshStandardMaterial).emissive.setHex(hue);
            phoneBar.position.y=.29-(prop.value%4)*.15;
          }
          if(prop.id==='book'&&prop.action==='page-turn')pageTurn=1;
        }
        pageTurn=Math.max(0,pageTurn-Math.min(dtMs,50)/520);
        pageLeaf.rotation.y=Math.sin((1-pageTurn)*Math.PI)*-2.65;
        if (pendingRobotCapturedAt != null) {
          presentedRobotCapturedAt = pendingRobotCapturedAt;
          pendingRobotCapturedAt = null;
        }
      }
      const cam = mode === 'cloud' ? perspCam : mode === 'robohand' ? robotCam : orthoCam;
      void renderer.render(scene, cam);
    },

    dispose() {
      robotRigs.forEach(rig=>rig.dispose());
      robotEnvironment?.dispose();
      robotFloor.geometry.dispose();
      (robotFloor.material as THREE.Material).dispose();
      robotHalo.geometry.dispose();
      (robotHalo.material as THREE.Material).dispose();
      propGeometries.forEach(geometry=>geometry.dispose());
      propMaterials.forEach(material=>material.dispose());
      renderer.dispose();
    }
  };

  api.setPointScale(1);
  api.resize();
  return api;
}
