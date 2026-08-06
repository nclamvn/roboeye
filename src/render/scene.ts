// Toàn bộ tầng render: WebGPURenderer (tự fallback WebGL2), 4 chế độ hiển thị,
// point cloud TSL sample depth texture ngay trong vertex stage nên buffer tĩnh,
// mỗi frame chỉ upload texture. Nội suy vị trí điểm giữa 2 depth frame bằng uMix.

import * as THREE from 'three/webgpu';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { texture, uniform, uv, float, vec2, vec3, mix, floor as tslFloor, instanceIndex, varying } from 'three/tsl';
import { BevBuilder } from './bev';
import type { Mode } from '../types';
import type { DetBox, RelativeBox3D } from '../detection-types';

// Ánh xạ relative depth (0..1, 1 = gần) sang khoảng cách tương đối qua inverse depth
const Z_NEAR = 0.5;
const Z_FAR = 6.0;

// Grid điểm: WebGPU 448x336 = 150.528 điểm (>=100k theo R4), WebGL 192x144 ≈ 27.6k (mục 9 PRD)
const GRID_WEBGPU: [number, number] = [448, 336];
const GRID_WEBGL: [number, number] = [192, 144];

type TexNode = ReturnType<typeof texture>;

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
  getDetections3D(): Array<RelativeBox3D | null>;
  resize(): void;
  render(dtMs: number): void;
  dispose(): void;
}

export async function createScene(canvas: HTMLCanvasElement, opts: { forceWebGL?: boolean } = {}): Promise<SceneAPI> {
  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL: opts.forceWebGL === true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  await renderer.init();
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
      controls.enabled = m === 'cloud';
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
      const cam = mode === 'cloud' ? perspCam : orthoCam;
      void renderer.render(scene, cam);
    },

    dispose() {
      renderer.dispose();
    }
  };

  api.setPointScale(1);
  api.resize();
  return api;
}
