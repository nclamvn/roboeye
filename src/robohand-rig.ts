import * as THREE from 'three/webgpu';
import { ROBOT_HAND_SEGMENTS, type RobotHandPose, type Vec3 } from './robohand-types';

export interface RobotHandRig {
  group: THREE.Group;
  setPose(pose: RobotHandPose | null): void;
  update(dtMs: number): void;
  dispose(): void;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
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
    const direction = normalized(REST_DIRECTIONS[index]);
    const parent = points[segment.parent];
    points[segment.child] = {
      x: parent.x + direction.x * segment.length,
      y: parent.y + direction.y * segment.length,
      z: parent.z + direction.z * segment.length
    };
  });
  return points;
}

function setBetween(
  object: THREE.Object3D,
  start: THREE.Vector3,
  end: THREE.Vector3,
  thickness: number
): void {
  const direction = end.clone().sub(start);
  const distance = Math.max(0.001, direction.length());
  direction.multiplyScalar(1 / distance);
  object.position.copy(start).addScaledVector(direction, distance / 2);
  object.quaternion.setFromUnitVectors(Y_AXIS, direction);
  object.scale.set(thickness, distance, thickness);
}

export function createRobotHandRig(): RobotHandRig {
  const group = new THREE.Group();
  group.name = 'RoboHandRig';
  group.position.set(0, -0.78, 0);

  const metal = new THREE.MeshStandardMaterial({
    color: 0xcbd0d0,
    metalness: .94,
    roughness: .2
  });
  const darkMetal = new THREE.MeshStandardMaterial({
    color: 0x151b1c,
    metalness: .82,
    roughness: .31
  });
  const carbon = new THREE.MeshStandardMaterial({
    color: 0x0a0f10,
    metalness: .42,
    roughness: .48
  });
  const actuator = new THREE.MeshStandardMaterial({
    color: 0xf2c94c,
    emissive: 0x7a4d00,
    emissiveIntensity: 1.25,
    metalness: .76,
    roughness: .22
  });
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x86e8ff,
    emissive: 0x0b6882,
    emissiveIntensity: .72,
    metalness: .12,
    roughness: .08,
    transmission: .2,
    transparent: true,
    opacity: .88
  });

  const shape = new THREE.Shape();
  shape.moveTo(-.57, -.12);
  shape.lineTo(.57, -.12);
  shape.lineTo(.47, .72);
  shape.lineTo(.25, .86);
  shape.lineTo(-.30, .84);
  shape.lineTo(-.52, .68);
  shape.closePath();
  const palmGeometry = new THREE.ExtrudeGeometry(shape, {
    depth: .16,
    bevelEnabled: true,
    bevelSegments: 3,
    bevelSize: .045,
    bevelThickness: .035,
    curveSegments: 2
  });
  palmGeometry.translate(0, 0, -.08);
  const palm = new THREE.Mesh(palmGeometry, carbon);
  palm.position.y = .05;
  palm.castShadow = true;
  palm.receiveShadow = true;
  group.add(palm);

  const palmPlate = new THREE.Mesh(new THREE.BoxGeometry(.73, .52, .055, 2, 2, 1), metal);
  palmPlate.position.set(.01, .40, .125);
  palmPlate.rotation.z = -.025;
  palmPlate.castShadow = true;
  group.add(palmPlate);

  const core = new THREE.Mesh(new THREE.CylinderGeometry(.12, .12, .06, 24), glass);
  core.rotation.x = Math.PI / 2;
  core.position.set(0, .39, .19);
  group.add(core);

  const wrist = new THREE.Mesh(new THREE.CylinderGeometry(.42, .50, .46, 18, 1), darkMetal);
  wrist.position.set(0, -.30, 0);
  wrist.castShadow = true;
  group.add(wrist);
  const wristRing = new THREE.Mesh(new THREE.TorusGeometry(.43, .035, 8, 28), actuator);
  wristRing.rotation.x = Math.PI / 2;
  wristRing.position.y = -.50;
  group.add(wristRing);

  const segmentGeometry = new THREE.CylinderGeometry(.82, 1, 1, 12, 1, false);
  const innerGeometry = new THREE.CylinderGeometry(.28, .28, 1, 8, 1, false);
  const jointGeometry = new THREE.SphereGeometry(1, 14, 10);
  const tipGeometry = new THREE.SphereGeometry(1, 16, 12);
  const segments: THREE.Mesh[] = [];
  const innerLinks: THREE.Mesh[] = [];
  const joints: THREE.Mesh[] = [];
  const targetPoints = createRobotHandRestPoints().map((point) => new THREE.Vector3(point.x, point.y, point.z));
  const displayPoints = targetPoints.map((point) => point.clone());

  for (let index = 0; index < 21; index++) {
    const isTip = [4, 8, 12, 16, 20].includes(index);
    const joint = new THREE.Mesh(isTip ? tipGeometry : jointGeometry, isTip ? metal : actuator);
    const radius = isTip ? .105 : index === 0 ? .15 : .086;
    joint.scale.setScalar(radius);
    joint.position.copy(displayPoints[index]);
    joint.castShadow = true;
    joints.push(joint);
    group.add(joint);
  }

  ROBOT_HAND_SEGMENTS.forEach((segment) => {
    const shell = new THREE.Mesh(segmentGeometry, segment.section % 2 === 0 ? metal : darkMetal);
    const radius = segment.finger === 'thumb' ? .092 : segment.finger === 'pinky' ? .068 : .077;
    shell.castShadow = true;
    segments.push(shell);
    group.add(shell);
    const tendon = new THREE.Mesh(innerGeometry, actuator);
    innerLinks.push(tendon);
    group.add(tendon);
    setBetween(shell, displayPoints[segment.parent], displayPoints[segment.child], radius);
    setBetween(tendon, displayPoints[segment.parent], displayPoints[segment.child], radius * .33);
  });

  const targetPosition = new THREE.Vector3(0, -.78, 0);
  const targetQuaternion = new THREE.Quaternion();
  let targetScale = 1;
  let tracking = false;

  function setPose(pose: RobotHandPose | null): void {
    tracking = pose != null;
    const source = pose?.points ?? createRobotHandRestPoints();
    for (let index = 0; index < targetPoints.length; index++) {
      targetPoints[index].set(source[index].x, source[index].y, source[index].z);
    }
    if (pose) {
      targetPosition.set(pose.rootPosition.x * .28, -.78 + pose.rootPosition.y * .22, pose.rootPosition.z * .18);
      targetQuaternion.set(
        pose.rootOrientation.x,
        pose.rootOrientation.y,
        pose.rootOrientation.z,
        pose.rootOrientation.w
      );
      targetScale = .88 * pose.rootScale;
    } else {
      targetPosition.set(0, -.78, 0);
      targetQuaternion.identity();
      targetScale = 1;
    }
  }

  function update(dtMs: number): void {
    const response = 1 - Math.exp(-Math.min(50, Math.max(0, dtMs)) / (tracking ? 38 : 190));
    group.position.lerp(targetPosition, response);
    group.quaternion.slerp(targetQuaternion, response);
    const nextScale = THREE.MathUtils.lerp(group.scale.x, targetScale, response);
    group.scale.setScalar(nextScale);
    for (let index = 0; index < displayPoints.length; index++) {
      displayPoints[index].lerp(targetPoints[index], response);
      joints[index].position.copy(displayPoints[index]);
    }
    ROBOT_HAND_SEGMENTS.forEach((segment, index) => {
      const radius = segment.finger === 'thumb' ? .092 : segment.finger === 'pinky' ? .068 : .077;
      setBetween(segments[index], displayPoints[segment.parent], displayPoints[segment.child], radius);
      setBetween(innerLinks[index], displayPoints[segment.parent], displayPoints[segment.child], radius * .33);
    });
  }

  return {
    group,
    setPose,
    update,
    dispose() {
      palmGeometry.dispose();
      palmPlate.geometry.dispose();
      core.geometry.dispose();
      wrist.geometry.dispose();
      wristRing.geometry.dispose();
      segmentGeometry.dispose();
      innerGeometry.dispose();
      jointGeometry.dispose();
      tipGeometry.dispose();
      metal.dispose();
      darkMetal.dispose();
      carbon.dispose();
      actuator.dispose();
      glass.dispose();
    }
  };
}

