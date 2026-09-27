import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three/webgpu';
import { createRobotHandRig, createRobotHandRestPoints } from '../../src/robohand-rig';
import { ROBOT_HAND_SEGMENTS, type RobotHandPose } from '../../src/robohand-types';
import { solveRobotHandPose } from '../../src/robohand-pose';
import { precisionFrame, precisionHand } from '../fixtures/robohand-precision';

test('native left and right rigs keep positive world scale while fallback chirality stays discrete', () => {
  const rightPose=solveRobotHandPose(precisionFrame(precisionHand(),0,false));
  const leftPose=solveRobotHandPose(precisionFrame(precisionHand(),0,true));
  assert.ok(rightPose&&leftPose);
  const rigs=[createRobotHandRig({modelHandedness:'Right'}),createRobotHandRig({modelHandedness:'Left'})];
  for(const [rig,pose] of [[rigs[0],rightPose],[rigs[1],leftPose]] as const){
    rig.setPose(pose);
    for(let frame=0;frame<30;frame++)rig.update(16);
    rig.group.updateMatrixWorld(true);
  }
  assert.ok(rigs[0].group.scale.x>0,'right hand lost base chirality');
  assert.ok(rigs[1].group.scale.x>0,'native left asset must never use a negative world scale');
  assert.ok(rigs[0].group.matrixWorld.determinant()>0&&rigs[1].group.matrixWorld.determinant()>0,
    'native rig transform lost right-handed topology');
  const rightFallback=rigs[0].group.getObjectByName('RoboHandFallback')!;
  const leftFallback=rigs[1].group.getObjectByName('RoboHandFallback')!;
  rightFallback.updateMatrixWorld(true);leftFallback.updateMatrixWorld(true);
  assert.ok(rightFallback.matrixWorld.determinant()*leftFallback.matrixWorld.determinant()<0,
    'emergency fallback meshes do not preserve opposite chirality');
  assert.equal(rigs[0].group.userData.modelName,'Sharpa Wave Right');
  assert.equal(rigs[1].group.userData.modelName,'Sharpa Wave Left');

  rigs[0].setPose(leftPose);
  rigs[0].update(16);
  assert.ok(rigs[0].group.scale.x>.2,'fixed right asset collapsed after contradictory observation');
  rigs.forEach(rig=>rig.dispose());
});

test('humanoid shells keep finite rigid transforms through flexion and palm rotation', () => {
  const rig = createRobotHandRig();
  for (const flex of [0, .45, 1.1, Math.PI / 2]) {
    const points = createRobotHandRestPoints();
    const directions = ROBOT_HAND_SEGMENTS.map(segment => {
      const d = new THREE.Vector3().copy(points[segment.child]).sub(points[segment.parent]).normalize();
      if (segment.section > 0) d.set(d.x * .1, Math.cos(flex * segment.section), -Math.sin(flex * segment.section)).normalize();
      return { x: d.x, y: d.y, z: d.z };
    });
    ROBOT_HAND_SEGMENTS.forEach((segment, index) => {
      const p = points[segment.parent], d = directions[index];
      points[segment.child] = { x: p.x + d.x * segment.length, y: p.y + d.y * segment.length, z: p.z + d.z * segment.length };
    });
    const pose: RobotHandPose = {
      points, directions, rootPosition: { x: 0, y: 0, z: 0 },
      rootOrientation: new THREE.Quaternion().setFromEuler(new THREE.Euler(.3, flex, -.2)),
      rootScale: 1, handedness: 'Right', handednessScore: 1, capturedAt: 0, receivedAt: 0
    };
    rig.setPose(pose);
    for (let frame = 0; frame < 30; frame++) {
      rig.update(16);
      for (const segment of ROBOT_HAND_SEGMENTS.filter(s => s.section === 1 || s.section === 2)) {
        const start = rig.group.getObjectByName(`${segment.finger}-phalange-${segment.section}`)!;
        const next = rig.group.getObjectByName(`${segment.finger}-phalange-${segment.section + 1}`)!;
        const endpoint = new THREE.Vector3(0, segment.length, 0).applyQuaternion(start.quaternion).add(start.position);
        assert.ok(endpoint.distanceTo(next.position) < 1e-8, `disconnected ${segment.finger} at frame ${frame}`);
      }
    }
    rig.group.updateMatrixWorld(true);
    let links = 0;
    rig.group.traverse(object => {
      assert.ok(object.matrixWorld.elements.every(Number.isFinite), object.name);
      if (object.name.includes('-phalange-')) {
        links++;
        assert.ok(Math.abs(object.quaternion.length() - 1) < 1e-6);
        assert.ok(object.scale.equals(new THREE.Vector3(1, 1, 1)), 'shell must not stretch with landmark jitter');
      }
    });
    assert.equal(links, 15);
  }
  rig.setPose(null);
  rig.update(16);
  rig.dispose();
});

test('shell roll remains continuous while crossing the transverse-axis singularity', () => {
  const rig = createRobotHandRig();
  let previous: THREE.Quaternion | null = null;
  for (let step = 0; step <= 60; step++) {
    const angle = .15 - step * .005;
    const points = createRobotHandRestPoints();
    const directions = ROBOT_HAND_SEGMENTS.map(segment => {
      const d = segment.section === 0
        ? new THREE.Vector3().copy(points[segment.child]).normalize()
        : new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
      const parent = points[segment.parent];
      points[segment.child] = { x: parent.x + d.x * segment.length, y: parent.y + d.y * segment.length, z: parent.z + d.z * segment.length };
      return { x: d.x, y: d.y, z: d.z };
    });
    rig.setPose({ points, directions, rootPosition: { x: 0, y: 0, z: 0 }, rootOrientation: { x: 0, y: 0, z: 0, w: 1 },
      rootScale: 1, handedness: 'Right', handednessScore: 1, capturedAt: step * 33, receivedAt: step * 33 });
    for (let i = 0; i < 12; i++) rig.update(16);
    const rotation = rig.group.getObjectByName('index-phalange-1')!.quaternion;
    if (previous) assert.ok(rotation.angleTo(previous) < .03, `roll flip at step ${step}`);
    previous = rotation.clone();
  }
  rig.dispose();
});

test('humanoid resources stay bounded and every shared geometry is disposed once', () => {
  const rig = createRobotHandRig();
  const geometries = new Set<THREE.BufferGeometry>();
  let meshes = 0, triangles = 0;
  rig.group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    meshes++;
    const geometry = object.geometry;
    geometries.add(geometry);
    triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3;
    assert.ok(Array.from(geometry.attributes.normal.array).every(Number.isFinite));
  });
  assert.ok(meshes <= 120, `${meshes} meshes`);
  assert.ok(triangles < 60000, `${triangles} triangles`);
  const counts = new Map<THREE.BufferGeometry, number>();
  geometries.forEach(g => g.addEventListener('dispose', () => counts.set(g, (counts.get(g) ?? 0) + 1)));
  rig.dispose();
  geometries.forEach(g => assert.equal(counts.get(g), 1));
});
