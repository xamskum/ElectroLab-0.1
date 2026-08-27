/**
 * Laboratory room — brighter, clearer orientation
 */

import * as THREE from 'three';

export interface LabRoomResult {
  group: THREE.Group;
  colliders: THREE.Box3[];
}

export function createLabRoom(): LabRoomResult {
  const group = new THREE.Group();
  const colliders: THREE.Box3[] = [];

  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2a3548, roughness: 0.75, metalness: 0.08 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x3a4a5e, roughness: 0.88, metalness: 0.05 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x6a7a8c, roughness: 0.35, metalness: 0.65 });
  const metalDark = new THREE.MeshStandardMaterial({ color: 0x3d4a58, roughness: 0.4, metalness: 0.5 });
  const neonMat = new THREE.MeshStandardMaterial({ color: 0x00e5ff, emissive: 0x00ccee, emissiveIntensity: 0.85 });
  const baseboardMat = new THREE.MeshStandardMaterial({ color: 0x00aacc, emissive: 0x006688, emissiveIntensity: 0.25, roughness: 0.5 });

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  const grid = new THREE.GridHelper(10, 20, 0x4a90b8, 0x2a4058);
  grid.position.y = 0.015;
  group.add(grid);

  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshStandardMaterial({ color: 0x1a2435, roughness: 0.9 }));
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = 3.2;
  group.add(ceil);

  const wallH = 3.2;
  const wGeo = new THREE.PlaneGeometry(10, wallH);
  for (const [x, y, z, ry] of [[0, wallH/2, -5, 0], [0, wallH/2, 5, Math.PI], [5, wallH/2, 0, -Math.PI/2], [-5, wallH/2, 0, Math.PI/2]] as const) {
    const w = new THREE.Mesh(wGeo, wallMat);
    w.position.set(x, y, z);
    w.rotation.y = ry;
    group.add(w);
  }

  colliders.push(
    new THREE.Box3(new THREE.Vector3(-5.1, 0, -5.25), new THREE.Vector3(5.1, wallH, -4.85)),
    new THREE.Box3(new THREE.Vector3(-5.1, 0, 4.85), new THREE.Vector3(5.1, wallH, 5.25)),
    new THREE.Box3(new THREE.Vector3(4.85, 0, -5.1), new THREE.Vector3(5.25, wallH, 5.1)),
    new THREE.Box3(new THREE.Vector3(-5.25, 0, -5.1), new THREE.Vector3(-4.85, wallH, 5.1))
  );

  // Neon baseboards
  for (const [x, y, z, sx, sy, sz] of [
    [0, 0.04, -4.97, 10, 0.08, 0.06],
    [0, 0.04, 4.97, 10, 0.08, 0.06],
    [4.97, 0.04, 0, 0.06, 0.08, 10],
    [-4.97, 0.04, 0, 0.06, 0.08, 10],
  ] as const) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), baseboardMat);
    m.position.set(x, y, z);
    group.add(m);
  }

  const topStrip = new THREE.Mesh(new THREE.BoxGeometry(9.5, 0.04, 0.04), neonMat);
  topStrip.position.set(0, 3.05, -4.96);
  group.add(topStrip);

  // Table
  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.08, 1.2), metalMat);
  tableTop.position.set(-1.5, 0.85, -1.5);
  tableTop.castShadow = true;
  tableTop.receiveShadow = true;
  group.add(tableTop);
  const tableEdge = new THREE.Mesh(
    new THREE.BoxGeometry(2.42, 0.02, 1.22),
    new THREE.MeshStandardMaterial({ color: 0x00ccee, emissive: 0x0088aa, emissiveIntensity: 0.4 })
  );
  tableEdge.position.set(-1.5, 0.9, -1.5);
  group.add(tableEdge);
  for (const [x, z] of [[-2.55, -2], [-0.45, -2], [-2.55, -1], [-0.45, -1]] as const) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.85, 0.08), metalDark);
    leg.position.set(x, 0.425, z);
    leg.castShadow = true;
    group.add(leg);
  }
  colliders.push(new THREE.Box3(new THREE.Vector3(-2.7, 0, -2.15), new THREE.Vector3(-0.3, 0.9, -0.85)));

  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.9, 0.12), new THREE.MeshStandardMaterial({ color: 0x243040, metalness: 0.45, roughness: 0.4 }));
  panel.position.set(1.5, 1.6, -4.9);
  group.add(panel);
  const pFrame = new THREE.Mesh(new THREE.BoxGeometry(1.3, 1.0, 0.05), neonMat);
  pFrame.position.set(1.5, 1.6, -4.97);
  group.add(pFrame);

  const sign = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.38), new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xff8800, emissiveIntensity: 0.45 }));
  sign.position.set(-2.6, 2.15, -4.92);
  group.add(sign);

  const lightFix = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.1, 0.5), metalDark);
  lightFix.position.set(0, 3.12, 0);
  group.add(lightFix);
  const strip = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.06, 0.35), new THREE.MeshStandardMaterial({ color: 0xffffee, emissive: 0xffffcc, emissiveIntensity: 2.2 }));
  strip.position.set(0, 3.05, 0);
  group.add(strip);

  const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.42, 32), new THREE.MeshStandardMaterial({ color: 0x00ccee, emissive: 0x0088aa, emissiveIntensity: 0.35, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.02;
  group.add(ring);

  return { group, colliders };
}
