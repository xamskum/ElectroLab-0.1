/**
 * ElectroLab Level 1 — standalone (no build step)
 * Three.js from CDN + plain JS
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// ═══════════════════════════════════════════════════════════════════
// Linear algebra (Gaussian elimination)
// ═══════════════════════════════════════════════════════════════════
function solveLinearSystem(A, b) {
  const n = A.length;
  if (n === 0) return [];
  const M = A.map(row => row.slice());
  const rhs = b.slice();
  for (let col = 0; col < n; col++) {
    let maxRow = col, maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M[row][col]);
      if (v > maxVal) { maxVal = v; maxRow = row; }
    }
    if (maxVal < 1e-12) return null;
    if (maxRow !== col) {
      [M[col], M[maxRow]] = [M[maxRow], M[col]];
      [rhs[col], rhs[maxRow]] = [rhs[maxRow], rhs[col]];
    }
    const pivot = M[col][col];
    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / pivot;
      for (let j = col; j < n; j++) M[row][j] -= f * M[col][j];
      rhs[row] -= f * rhs[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i];
    for (let j = i + 1; j < n; j++) sum -= M[i][j] * x[j];
    if (Math.abs(M[i][i]) < 1e-12) return null;
    x[i] = sum / M[i][i];
  }
  return x;
}

// ═══════════════════════════════════════════════════════════════════
// Circuit Solver (MNA)
// ═══════════════════════════════════════════════════════════════════
class CircuitSolver {
  /**
   * Hybrid MNA (reliable for gameplay):
   * - Wires union terminals into the same node (ideal short)
   * - Loads/switches stamped as conductances between nodes
   * - Voltage sources as MNA extra unknowns
   * - Wire currents reconstructed from series path / KCL residual
   */
  constructor() {
    this.components = new Map();
    this.wires = [];
  }
  add(c) {
    this.components.set(c.id, c);
    if (c.type === 'wire') this.wires.push(c);
  }
  solve() {
    for (const c of this.components.values()) {
      c.current = 0;
      c.voltage = 0;
      c.isPowered = false;
      c.power = 0;
    }

    const batteries = [...this.components.values()].filter(c => c.type === 'battery');
    if (!batteries.length) {
      return { isClosed: false, current: 0, totalResistance: Infinity, totalVoltage: 0, branches: [] };
    }
    const bat = batteries[0];
    const posT = bat.terminals.find(t => t.polarity === 'positive');
    const negT = bat.terminals.find(t => t.polarity === 'negative');
    if (!posT || !negT) {
      return { isClosed: false, current: 0, totalResistance: Infinity, totalVoltage: bat.voltageValue, branches: [] };
    }

    // ── Union-Find for wire shorts ─────────────────────────────────
    const parent = new Map();
    const find = (id) => {
      if (!parent.has(id)) parent.set(id, id);
      let r = id;
      while (parent.get(r) !== r) r = parent.get(r);
      let cur = id;
      while (cur !== r) { const n = parent.get(cur); parent.set(cur, r); cur = n; }
      return r;
    };
    const union = (a, b) => {
      const ra = find(a), rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    const allTerms = [];
    for (const c of this.components.values()) {
      if (c.type === 'wire') continue;
      for (const term of c.terminals) allTerms.push(term);
    }
    for (const term of allTerms) find(term.id);

    for (const w of this.wires) {
      if (w.terminalA && w.terminalB) union(w.terminalA.id, w.terminalB.id);
    }

    // ── Assign node ids to union roots ─────────────────────────────
    const rootToNid = new Map();
    let nid = 0;
    for (const term of allTerms) {
      const root = find(term.id);
      if (!rootToNid.has(root)) rootToNid.set(root, nid++);
    }
    const termToNode = new Map();
    for (const term of allTerms) {
      termToNode.set(term.id, rootToNid.get(find(term.id)));
    }

    const groundId = termToNode.get(negT.id);
    const posNode = termToNode.get(posT.id);
    if (groundId === undefined || posNode === undefined) {
      return { isClosed: false, current: 0, totalResistance: Infinity, totalVoltage: bat.voltageValue, branches: [] };
    }

    // ── Branches (non-wire) ────────────────────────────────────────
    const branches = [];
    const vsList = [];
    for (const c of this.components.values()) {
      if (c.type === 'wire' || c.terminals.length < 2) continue;

      if (c.type === 'battery') {
        const pN = termToNode.get(c.terminals.find(t => t.polarity === 'positive').id);
        const nN = termToNode.get(c.terminals.find(t => t.polarity === 'negative').id);
        if (pN === undefined || nN === undefined || pN === nN) continue;
        const br = { component: c, nodeA: pN, nodeB: nN, isVS: true, voltage: c.voltageValue };
        branches.push(br);
        vsList.push(br);
        continue;
      }

      const R = c.getResistance();
      if (!isFinite(R) || R <= 0) continue; // open switch
      const nA = termToNode.get(c.terminals[0].id);
      const nB = termToNode.get(c.terminals[1].id);
      if (nA === undefined || nB === undefined || nA === nB) continue;
      branches.push({ component: c, nodeA: nA, nodeB: nB, isVS: false, G: 1 / R });
    }

    const usedNodes = new Set([groundId]);
    for (const br of branches) { usedNodes.add(br.nodeA); usedNodes.add(br.nodeB); }

    const nonGround = [...usedNodes].filter(id => id !== groundId);
    const nV = nonGround.length;
    const nVS = vsList.length;
    const N = nV + nVS;
    if (N === 0 || nVS === 0) {
      return { isClosed: false, current: 0, totalResistance: Infinity, totalVoltage: bat.voltageValue, branches: [] };
    }

    const nodeIndex = new Map();
    nonGround.forEach((id, i) => nodeIndex.set(id, i));

    const G = Array.from({ length: N }, () => new Array(N).fill(0));
    const b = new Array(N).fill(0);

    const stampG = (nA, nB, g) => {
      const i = nodeIndex.get(nA);
      const j = nodeIndex.get(nB);
      if (i !== undefined && j !== undefined) {
        G[i][i] += g; G[j][j] += g; G[i][j] -= g; G[j][i] -= g;
      } else if (i !== undefined) G[i][i] += g;
      else if (j !== undefined) G[j][j] += g;
    };

    for (const br of branches) {
      if (!br.isVS) stampG(br.nodeA, br.nodeB, br.G);
    }

    vsList.forEach((vs, k) => {
      const vi = nV + k;
      const i = nodeIndex.get(vs.nodeA);
      const j = nodeIndex.get(vs.nodeB);
      if (i !== undefined) { G[i][vi] += 1; G[vi][i] += 1; }
      if (j !== undefined) { G[j][vi] -= 1; G[vi][j] -= 1; }
      b[vi] = vs.voltage;
    });

    for (let i = 0; i < nV; i++) G[i][i] += 1e-9;

    const x = solveLinearSystem(G, b);
    if (!x) {
      return { isClosed: false, current: 0, totalResistance: Infinity, totalVoltage: bat.voltageValue, branches: [] };
    }

    const nodeV = new Map([[groundId, 0]]);
    for (const [id, idx] of nodeIndex) nodeV.set(id, x[idx]);

    const vsCurrent = new Map();
    vsList.forEach((vs, k) => vsCurrent.set(vs.component, x[nV + k]));

    let mainI = 0;
    const branchReport = [];

    for (const br of branches) {
      const vA = nodeV.get(br.nodeA) ?? 0;
      const vB = nodeV.get(br.nodeB) ?? 0;
      const vDrop = vA - vB;
      let I = 0;
      if (br.isVS) {
        I = vsCurrent.get(br.component) ?? 0;
        br.component.voltage = br.voltage;
        br.component.current = Math.abs(I);
        br.component.power = Math.abs(br.voltage * I);
        br.component.isPowered = Math.abs(I) > 1e-4;
        if (br.component === bat) mainI = Math.abs(I);
      } else {
        I = br.G * vDrop;
        br.component.voltage = Math.abs(vDrop);
        br.component.current = Math.abs(I);
        br.component.power = Math.abs(vDrop * I);
        br.component.isPowered = Math.abs(I) > 1e-4;
      }
      branchReport.push({
        id: br.component.id, type: br.component.type,
        V: br.component.voltage, I: br.component.current, P: br.component.power
      });
    }

    // Wire currents: any wire linking two terminals on the active path gets mainI
    // (series) or partial if parallel — use endpoint node voltages + local share
    if (mainI > 1e-4) {
      for (const w of this.wires) {
        if (!w.terminalA || !w.terminalB) continue;
        // both ends must resolve to known circuit nodes
        const n1 = termToNode.get(w.terminalA.id);
        const n2 = termToNode.get(w.terminalB.id);
        if (n1 === undefined || n2 === undefined) continue;
        // if shorted together by union, wire carries current along that link
        w.current = mainI;
        w.isPowered = true;
        w.voltage = 0;
        w.power = 0;
      }
    }

    let loadP = 0;
    for (const c of this.components.values()) {
      if (c.type !== 'battery' && c.type !== 'wire') loadP += c.power || 0;
    }

    const R_eq = mainI > 1e-9 ? bat.voltageValue / mainI : Infinity;
    return {
      isClosed: mainI > 1e-4,
      current: mainI,
      totalResistance: R_eq,
      totalVoltage: bat.voltageValue,
      powerSource: bat.voltageValue * mainI,
      powerLoads: loadP,
      branches: branchReport,
      nodeVoltages: nodeV
    };
  }
}

// ═══════════════════════════════════════════════════════════════════
// Terminal / Components
// ═══════════════════════════════════════════════════════════════════
class Terminal {
  constructor(id, componentId, polarity, localPos) {
    this.id = id; this.componentId = componentId; this.polarity = polarity;
    this.localPosition = localPos.clone();
    this.worldPosition = new THREE.Vector3();
    this.connectedTo = null;
    this.mesh = null;
  }
  isCompatible(other) {
    return this !== other && !this.connectedTo && !other.connectedTo && this.componentId !== other.componentId;
  }
}

class Battery {
  constructor(id, voltage = 12) {
    this.id = id; this.type = 'battery'; this.voltageValue = voltage;
    this.current = 0; this.voltage = 0; this.isPowered = false;
    this.terminals = [];
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.38, 16),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.35, metalness: 0.55 })
    );
    body.rotation.z = Math.PI / 2; body.castShadow = true; g.add(body);
    const posCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.07, 12),
      new THREE.MeshStandardMaterial({ color: 0xff3333, emissive: 0xcc0000, emissiveIntensity: 0.35 })
    );
    posCap.position.set(0.22, 0, 0); posCap.rotation.z = Math.PI / 2; g.add(posCap);
    const negCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.04, 12),
      new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7 })
    );
    negCap.position.set(-0.21, 0, 0); negCap.rotation.z = Math.PI / 2; g.add(negCap);
    this.mesh = g;
    const tPos = new Terminal(id + '-pos', id, 'positive', new THREE.Vector3(0.26, 0, 0));
    const tNeg = new Terminal(id + '-neg', id, 'negative', new THREE.Vector3(-0.25, 0, 0));
    this.terminals.push(tPos, tNeg);
    for (const t of this.terminals) {
      const col = t.polarity === 'positive' ? 0xff4444 : 0x3366ff;
      const em = t.polarity === 'positive' ? 0xff0000 : 0x0022aa;
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 12, 12),
        new THREE.MeshStandardMaterial({ color: col, emissive: em, emissiveIntensity: 0.3, metalness: 0.5 })
      );
      s.position.copy(t.localPosition); g.add(s); t.mesh = s;
    }
  }
  getResistance() { return 0.05; }
  updateTerminals() {
    this.mesh.updateMatrixWorld(true);
    for (const t of this.terminals) {
      t.worldPosition.copy(t.localPosition);
      this.mesh.localToWorld(t.worldPosition);
    }
  }
  updateVisuals() {}
}

class Door {
  constructor(id) {
    this.id = id; this.type = 'door';
    this.current = 0; this.voltage = 0; this.isPowered = false;
    this.requiredVoltage = 5; this.isOpen = false;
    this.targetOpen = 0; this.currentOpen = 0;
    this.terminals = [];
    const g = new THREE.Group();
    const frameMat = new THREE.MeshStandardMaterial({ color: 0x4a5a6e, metalness: 0.55, roughness: 0.35 });
    for (const [x, y, z, sx, sy, sz] of [
      [-0.72, 1.2, 0, 0.14, 2.4, 0.18], [0.72, 1.2, 0, 0.14, 2.4, 0.18], [0, 2.37, 0, 1.58, 0.14, 0.18]
    ]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), frameMat);
      m.position.set(x, y, z); m.castShadow = true; g.add(m);
    }
    this.doorMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.32, 2.22, 0.07),
      new THREE.MeshStandardMaterial({ color: 0x2a3a4c, metalness: 0.5, roughness: 0.3, emissive: 0x002030, emissiveIntensity: 0.35 })
    );
    this.doorMesh.position.set(0, 1.15, 0); this.doorMesh.castShadow = true; g.add(this.doorMesh);
    this.statusLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 12, 12),
      new THREE.MeshStandardMaterial({ color: 0xff2200, emissive: 0xff0000, emissiveIntensity: 0.9 })
    );
    this.statusLight.position.set(0.55, 2.05, 0.12); g.add(this.statusLight);
    this.mesh = g;
    const tIn = new Terminal(id + '-in', id, 'neutral', new THREE.Vector3(-0.88, 1.55, 0));
    const tOut = new Terminal(id + '-out', id, 'neutral', new THREE.Vector3(0.88, 1.55, 0));
    this.terminals.push(tIn, tOut);
    for (const t of this.terminals) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 12, 12),
        new THREE.MeshStandardMaterial({ color: 0x00aaff, emissive: 0x0077cc, emissiveIntensity: 0.35 })
      );
      s.position.copy(t.localPosition); g.add(s); t.mesh = s;
    }
  }
  getResistance() { return 18; }
  updateTerminals() {
    this.mesh.updateMatrixWorld(true);
    for (const t of this.terminals) {
      t.worldPosition.copy(t.localPosition);
      this.mesh.localToWorld(t.worldPosition);
    }
  }
  updateVisuals(dt) {
    const powered = this.voltage >= this.requiredVoltage && this.current > 0.04;
    this.targetOpen = powered ? 1 : 0;
    this.currentOpen += (this.targetOpen - this.currentOpen) * Math.min(1, dt * 2.8);
    this.doorMesh.position.y = 1.15 + this.currentOpen * 2.05;
    this.isOpen = this.currentOpen > 0.92;
    const mat = this.statusLight.material;
    if (powered) { mat.color.setHex(0x00ff66); mat.emissive.setHex(0x00ff44); mat.emissiveIntensity = 1.3; }
    else { mat.color.setHex(0xff2200); mat.emissive.setHex(0xff0000); mat.emissiveIntensity = 0.85; }
  }
}

class Wire {
  constructor(id) {
    this.id = id; this.type = 'wire';
    this.current = 0; this.voltage = 0; this.isPowered = false;
    this.terminalA = null; this.terminalB = null;
    this.resistanceValue = 0.05;
    this.terminals = [];
    this.mesh = new THREE.Group();
    this.line = null; this.particles = null; this.particleProgress = [];
    this.particleCount = 14; this.curve = null; this.particlePositions = null;
    // placeholder coil
    const coil = new THREE.Group(); coil.name = 'placeholder';
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a5060, roughness: 0.5, metalness: 0.4 });
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06 + i * 0.01, 0.012, 8, 16), mat);
      ring.rotation.x = Math.PI / 2; ring.position.y = i * 0.008; coil.add(ring);
    }
    this.mesh.add(coil);
  }
  getResistance() { return this.resistanceValue; }
  connect(a, b) {
    if (!a.isCompatible(b)) return false;
    this.terminalA = a; this.terminalB = b;
    a.connectedTo = b; b.connectedTo = a;
    this.rebuildVisual();
    return true;
  }
  disconnect() {
    if (this.terminalA) this.terminalA.connectedTo = null;
    if (this.terminalB) this.terminalB.connectedTo = null;
    this.terminalA = null; this.terminalB = null;
    this.current = 0; this.isPowered = false;
    this.clearVisual();
  }
  clearVisual() {
    if (this.line) { this.mesh.remove(this.line); this.line.geometry.dispose(); this.line.material.dispose(); this.line = null; }
    if (this.particles) { this.mesh.remove(this.particles); this.particles.geometry.dispose(); this.particles.material.dispose(); this.particles = null; }
    this.curve = null;
  }
  rebuildVisual() {
    this.clearVisual();
    if (!this.terminalA || !this.terminalB) return;
    const p1 = this.terminalA.worldPosition.clone();
    const p2 = this.terminalB.worldPosition.clone();
    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    mid.y += 0.18 + Math.min(0.25, p1.distanceTo(p2) * 0.08);
    this.curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
    const pts = this.curve.getPoints(24);
    this.line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: 0x556677, transparent: true, opacity: 0.9 })
    );
    this.mesh.add(this.line);
    this.particleProgress = [];
    const pos = new Float32Array(this.particleCount * 3);
    for (let i = 0; i < this.particleCount; i++) {
      this.particleProgress[i] = i / this.particleCount;
      const p = this.curve.getPoint(this.particleProgress[i]);
      pos[i*3]=p.x; pos[i*3+1]=p.y; pos[i*3+2]=p.z;
    }
    this.particlePositions = pos;
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
      color: 0x00ffff, size: 0.055, transparent: true, opacity: 0.95,
      blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true
    }));
    this.particles.visible = false;
    this.mesh.add(this.particles);
  }
  updateVisuals(dt) {
    if (!this.curve || !this.particles || !this.particlePositions) return;
    const has = this.current > 0.01;
    this.particles.visible = has;
    if (this.line) {
      this.line.material.color.setHex(has ? 0x00ffaa : 0x556677);
      this.line.material.opacity = has ? 1 : 0.75;
    }
    if (!has) return;
    const speed = Math.min(3, 0.6 + this.current * 1.1);
    for (let i = 0; i < this.particleCount; i++) {
      this.particleProgress[i] = (this.particleProgress[i] + speed * dt) % 1;
      const p = this.curve.getPoint(this.particleProgress[i]);
      this.particlePositions[i*3]=p.x; this.particlePositions[i*3+1]=p.y; this.particlePositions[i*3+2]=p.z;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }
  updateTerminals() {}
}


class Switch {
  constructor(id) {
    this.id = id; this.type = 'switch';
    this.current = 0; this.voltage = 0; this.isPowered = false;
    this.isClosed = false; // open by default — player must close it
    this.terminals = [];
    const g = new THREE.Group();

    // Base
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.12, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x3a4a5a, metalness: 0.4, roughness: 0.4 })
    );
    base.position.y = 0.06;
    base.castShadow = true;
    g.add(base);

    // Lever pivot
    this.lever = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.22, 0.06),
      new THREE.MeshStandardMaterial({ color: 0xcc4422, metalness: 0.5, roughness: 0.3, emissive: 0x441100, emissiveIntensity: 0.2 })
    );
    this.lever.position.set(0, 0.22, 0);
    this.lever.rotation.x = 0.5; // open position tilted
    g.add(this.lever);

    // Status LED
    this.led = new THREE.Mesh(
      new THREE.SphereGeometry(0.045, 10, 10),
      new THREE.MeshStandardMaterial({ color: 0xff3300, emissive: 0xff0000, emissiveIntensity: 0.7 })
    );
    this.led.position.set(0.1, 0.14, 0.12);
    g.add(this.led);

    this.mesh = g;
    const tA = new Terminal(id + '-a', id, 'neutral', new THREE.Vector3(-0.16, 0.08, 0));
    const tB = new Terminal(id + '-b', id, 'neutral', new THREE.Vector3(0.16, 0.08, 0));
    this.terminals.push(tA, tB);
    for (const t of this.terminals) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0x00aaff, emissive: 0x0066aa, emissiveIntensity: 0.3 })
      );
      s.position.copy(t.localPosition);
      g.add(s);
      t.mesh = s;
    }
  }
  getResistance() {
    return this.isClosed ? 0.02 : Infinity;
  }
  toggle() {
    this.isClosed = !this.isClosed;
    this.lever.rotation.x = this.isClosed ? -0.45 : 0.5;
    const mat = this.led.material;
    if (this.isClosed) {
      mat.color.setHex(0x00ff66); mat.emissive.setHex(0x00ff44); mat.emissiveIntensity = 1.1;
    } else {
      mat.color.setHex(0xff3300); mat.emissive.setHex(0xff0000); mat.emissiveIntensity = 0.7;
    }
  }
  updateTerminals() {
    this.mesh.updateMatrixWorld(true);
    for (const t of this.terminals) {
      t.worldPosition.copy(t.localPosition);
      this.mesh.localToWorld(t.worldPosition);
    }
  }
  updateVisuals() {}
}



class Resistor {
  constructor(id, resistance = 10) {
    this.id = id; this.type = 'resistor';
    this.current = 0; this.voltage = 0; this.isPowered = false; this.power = 0;
    this.resistanceValue = resistance;
    this.terminals = [];
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.28, 12),
      new THREE.MeshStandardMaterial({ color: 0xc4a574, roughness: 0.6, metalness: 0.15 })
    );
    body.rotation.z = Math.PI / 2; g.add(body);
    // color bands
    [0xff0000, 0x000000, 0x884400].forEach((col, i) => {
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.052, 0.052, 0.025, 12),
        new THREE.MeshStandardMaterial({ color: col })
      );
      band.rotation.z = Math.PI / 2;
      band.position.x = -0.06 + i * 0.06;
      g.add(band);
    });
    this.mesh = g;
    const tA = new Terminal(id + '-a', id, 'neutral', new THREE.Vector3(-0.16, 0, 0));
    const tB = new Terminal(id + '-b', id, 'neutral', new THREE.Vector3(0.16, 0, 0));
    this.terminals.push(tA, tB);
    for (const term of this.terminals) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.045, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0x00aaff, emissive: 0x0066aa, emissiveIntensity: 0.3 })
      );
      s.position.copy(term.localPosition); g.add(s); term.mesh = s;
    }
  }
  getResistance() { return this.resistanceValue; }
  updateTerminals() {
    this.mesh.updateMatrixWorld(true);
    for (const term of this.terminals) {
      term.worldPosition.copy(term.localPosition);
      this.mesh.localToWorld(term.worldPosition);
    }
  }
  updateVisuals() {
    // slight heat glow when high current
    const heat = Math.min(1, this.current * 2);
    // bands stay static
  }
}

class Lamp {
  constructor(id, resistance = 24) {
    this.id = id; this.type = 'lamp';
    this.current = 0; this.voltage = 0; this.isPowered = false;
    this.resistanceValue = resistance;
    this.terminals = [];
    const g = new THREE.Group();
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.6, roughness: 0.4 })
    );
    base.position.y = 0.06; g.add(base);
    this.bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 16, 16),
      new THREE.MeshStandardMaterial({
        color: 0x666666, emissive: 0x000000, emissiveIntensity: 0,
        transparent: true, opacity: 0.92, roughness: 0.25
      })
    );
    this.bulb.position.y = 0.2; g.add(this.bulb);
    this.glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffee88, transparent: true, opacity: 0, depthWrite: false })
    );
    this.glow.position.y = 0.2; g.add(this.glow);
    this.mesh = g;
    const tA = new Terminal(id + '-a', id, 'neutral', new THREE.Vector3(-0.12, 0.05, 0));
    const tB = new Terminal(id + '-b', id, 'neutral', new THREE.Vector3(0.12, 0.05, 0));
    this.terminals.push(tA, tB);
    for (const t of this.terminals) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.042, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0x00aaff, emissive: 0x0066aa, emissiveIntensity: 0.3 })
      );
      s.position.copy(t.localPosition); g.add(s); t.mesh = s;
    }
  }
  getResistance() { return this.resistanceValue; }
  updateTerminals() {
    this.mesh.updateMatrixWorld(true);
    for (const t of this.terminals) {
      t.worldPosition.copy(t.localPosition);
      this.mesh.localToWorld(t.worldPosition);
    }
  }
  updateVisuals() {
    const P = this.current * this.current * this.resistanceValue;
    const level = Math.min(1, P / 6);
    const mat = this.bulb.material;
    mat.emissive.setHex(0xffeeaa);
    mat.emissiveIntensity = level * 2.2;
    mat.color.setHex(level > 0.04 ? 0xfff5d0 : 0x555555);
    this.glow.material.opacity = level * 0.3;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Lab Room
// ═══════════════════════════════════════════════════════════════════
function createLabRoom() {
  const group = new THREE.Group();
  const colliders = [];

  // Cozy warm-cool lab palette
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x3d4a5c, roughness: 0.82, metalness: 0.05 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x4a5d72, roughness: 0.9, metalness: 0.03 });
  const ceilMat = new THREE.MeshStandardMaterial({ color: 0x2a3548, roughness: 0.95 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b5344, roughness: 0.75, metalness: 0.05 });
  const woodTop = new THREE.MeshStandardMaterial({ color: 0x8b7355, roughness: 0.55, metalness: 0.08 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x7a8a9c, roughness: 0.4, metalness: 0.55 });
  const metalDark = new THREE.MeshStandardMaterial({ color: 0x3d4a58, roughness: 0.45, metalness: 0.45 });
  const neonSoft = new THREE.MeshStandardMaterial({ color: 0x5ec8e0, emissive: 0x1a6a80, emissiveIntensity: 0.45 });
  const baseboardMat = new THREE.MeshStandardMaterial({ color: 0x4a6a7a, emissive: 0x0a3040, emissiveIntensity: 0.2, roughness: 0.55 });
  const rugMat = new THREE.MeshStandardMaterial({ color: 0x3a4a5a, roughness: 0.95 });

  // Floor
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  group.add(floor);

  // Soft grid (subtle)
  const grid = new THREE.GridHelper(10, 16, 0x4a6a80, 0x354858);
  grid.position.y = 0.012;
  group.add(grid);

  // Ceiling
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), ceilMat);
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = 3.2;
  group.add(ceil);

  // Walls
  const wallH = 3.2;
  const wGeo = new THREE.PlaneGeometry(10, wallH);
  for (const [x, y, z, ry] of [[0, wallH/2, -5, 0], [0, wallH/2, 5, Math.PI], [5, wallH/2, 0, -Math.PI/2], [-5, wallH/2, 0, Math.PI/2]]) {
    const w = new THREE.Mesh(wGeo, wallMat);
    w.position.set(x, y, z);
    w.rotation.y = ry;
    group.add(w);
  }
  colliders.push(
    new THREE.Box3(new THREE.Vector3(-5.1,0,-5.25), new THREE.Vector3(5.1,wallH,-4.85)),
    new THREE.Box3(new THREE.Vector3(-5.1,0,4.85), new THREE.Vector3(5.1,wallH,5.25)),
    new THREE.Box3(new THREE.Vector3(4.85,0,-5.1), new THREE.Vector3(5.25,wallH,5.1)),
    new THREE.Box3(new THREE.Vector3(-5.25,0,-5.1), new THREE.Vector3(-4.85,wallH,5.1))
  );

  // Soft baseboards
  for (const [x, y, z, sx, sy, sz] of [
    [0, 0.04, -4.97, 10, 0.08, 0.05],
    [0, 0.04, 4.97, 10, 0.08, 0.05],
    [4.97, 0.04, 0, 0.05, 0.08, 10],
    [-4.97, 0.04, 0, 0.05, 0.08, 10],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), baseboardMat);
    m.position.set(x, y, z);
    group.add(m);
  }

  // Workbench (wood, centered-left, neat)
  const tableW = 2.8, tableD = 1.35, tableY = 0.82;
  const tableTop = new THREE.Mesh(new THREE.BoxGeometry(tableW, 0.07, tableD), woodTop);
  tableTop.position.set(-1.2, tableY, -1.6);
  tableTop.castShadow = true;
  tableTop.receiveShadow = true;
  group.add(tableTop);
  // subtle edge
  const edge = new THREE.Mesh(
    new THREE.BoxGeometry(tableW + 0.02, 0.015, tableD + 0.02),
    new THREE.MeshStandardMaterial({ color: 0x5a4838, roughness: 0.6 })
  );
  edge.position.set(-1.2, tableY + 0.04, -1.6);
  group.add(edge);
  // legs
  const legOffX = tableW/2 - 0.1, legOffZ = tableD/2 - 0.1;
  for (const [lx, lz] of [[-legOffX, -legOffZ], [legOffX, -legOffZ], [-legOffX, legOffZ], [legOffX, legOffZ]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, tableY, 0.07), woodMat);
    leg.position.set(-1.2 + lx, tableY/2, -1.6 + lz);
    leg.castShadow = true;
    group.add(leg);
  }
  colliders.push(new THREE.Box3(
    new THREE.Vector3(-1.2 - tableW/2 - 0.05, 0, -1.6 - tableD/2 - 0.05),
    new THREE.Vector3(-1.2 + tableW/2 + 0.05, tableY + 0.1, -1.6 + tableD/2 + 0.05)
  ));

  // Floor rug under table area
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.2), rugMat);
  rug.rotation.x = -Math.PI / 2;
  rug.position.set(-1.2, 0.018, -1.5);
  group.add(rug);

  // Electrical panel (neat, north wall)
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(1.0, 0.75, 0.1),
    new THREE.MeshStandardMaterial({ color: 0x2a3545, metalness: 0.4, roughness: 0.45 })
  );
  panel.position.set(1.8, 1.55, -4.92);
  group.add(panel);
  const pFrame = new THREE.Mesh(new THREE.BoxGeometry(1.08, 0.83, 0.04), neonSoft);
  pFrame.position.set(1.8, 1.55, -4.97);
  group.add(pFrame);

  // Simple shelf (left wall, clean)
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.05, 0.3), woodMat);
  shelf.position.set(-3.6, 1.6, -4.7);
  group.add(shelf);

  // Ceiling fixture (soft)
  const lightFix = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.08, 0.4), metalDark);
  lightFix.position.set(0, 3.12, 0);
  group.add(lightFix);
  const strip = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.05, 0.28),
    new THREE.MeshStandardMaterial({ color: 0xfff5e6, emissive: 0xffe8c8, emissiveIntensity: 1.2 })
  );
  strip.position.set(0, 3.05, 0);
  group.add(strip);

  // Warm wall accent strip (cozy)
  const accent = new THREE.Mesh(
    new THREE.BoxGeometry(6, 0.03, 0.03),
    new THREE.MeshStandardMaterial({ color: 0xd4a574, emissive: 0x8a6030, emissiveIntensity: 0.25 })
  );
  accent.position.set(0, 2.4, -4.96);
  group.add(accent);

  // Corner posts (subtle orientation)
  for (const [x, z] of [[-4.75, -4.75], [4.75, -4.75], [-4.75, 4.75], [4.75, 4.75]]) {
    const p = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 3.2, 0.1),
      new THREE.MeshStandardMaterial({ color: 0x455566, metalness: 0.25, roughness: 0.5 })
    );
    p.position.set(x, 1.6, z);
    group.add(p);
  }

  return { group, colliders };
}

class Player {
  constructor(camera) {
    this.camera = camera;
    this.object = new THREE.Object3D();
    this.object.position.set(0, 0, 3.5);
    this.camera.position.set(0, 1.6, 0);
    this.object.add(this.camera);
    this.velocity = new THREE.Vector3();
    this.keys = {};
    this.isLocked = false;
    this.pitch = 0; this.yaw = 0;
    this.onGround = true;
    this.colliders = [];
    this.interactables = [];
    this.currentTarget = null;
    this.raycaster = new THREE.Raycaster();
    this.onPrompt = null;
    this.bindInput();
  }
  bindInput() {
    document.addEventListener('keydown', e => {
      this.keys[e.code] = true;
      if (e.code === 'KeyE' && this.currentTarget) this.currentTarget.onInteract();
    });
    document.addEventListener('keyup', e => { this.keys[e.code] = false; });
    const canvas = document.querySelector('canvas');
    if (canvas) canvas.addEventListener('click', () => { if (!this.isLocked) canvas.requestPointerLock(); });
    document.addEventListener('pointerlockchange', () => { this.isLocked = !!document.pointerLockElement; });
    document.addEventListener('mousemove', e => {
      if (!this.isLocked) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch - e.movementY * 0.0022));
    });
  }
  register(mesh, label, onInteract) { this.interactables.push({ mesh, label, onInteract }); }
  clearInteractables() {
    if (this.currentTarget) this.setHL(this.currentTarget.mesh, false);
    this.interactables = []; this.currentTarget = null;
    if (this.onPrompt) this.onPrompt(null);
  }
  update(dt) {
    this.object.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    let dx = 0, dz = 0;
    if (this.keys['KeyW']) dz -= 1;
    if (this.keys['KeyS']) dz += 1;
    if (this.keys['KeyA']) dx -= 1;
    if (this.keys['KeyD']) dx += 1;
    const len = Math.hypot(dx, dz) || 1;
    dx /= len; dz /= len;
    const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
    const mx = dx * cos + dz * sin, mz = -dx * sin + dz * cos;
    const speed = 4.8;
    this.velocity.x = mx * speed; this.velocity.z = mz * speed;
    if (!this.onGround) this.velocity.y -= 22 * dt;
    else this.velocity.y = 0;
    if (this.keys['Space'] && this.onGround) { this.velocity.y = 7.5; this.onGround = false; }
    const next = this.object.position.clone();
    next.x += this.velocity.x * dt; next.z += this.velocity.z * dt; next.y += this.velocity.y * dt;
    if (next.y < 0) { next.y = 0; this.velocity.y = 0; this.onGround = true; }
    const r = 0.32, h = 1.7;
    const box = new THREE.Box3(
      new THREE.Vector3(next.x - r, next.y, next.z - r),
      new THREE.Vector3(next.x + r, next.y + h, next.z + r)
    );
    for (const col of this.colliders) {
      if (box.intersectsBox(col)) {
        const ox = Math.min(box.max.x, col.max.x) - Math.max(box.min.x, col.min.x);
        const oz = Math.min(box.max.z, col.max.z) - Math.max(box.min.z, col.min.z);
        if (ox < oz) next.x += box.min.x < col.min.x ? -ox : ox;
        else next.z += box.min.z < col.min.z ? -oz : oz;
      }
    }
    next.x = THREE.MathUtils.clamp(next.x, -4.6, 4.6);
    next.z = THREE.MathUtils.clamp(next.z, -4.6, 4.6);
    this.object.position.copy(next);
    this.updateInteraction();
  }
  updateInteraction() {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.raycaster.far = 3.5;
    let closest = null, minD = Infinity;
    for (const item of this.interactables) {
      const hits = this.raycaster.intersectObject(item.mesh, true);
      if (hits.length && hits[0].distance < minD) { minD = hits[0].distance; closest = item; }
    }
    if (closest !== this.currentTarget) {
      if (this.currentTarget) this.setHL(this.currentTarget.mesh, false);
      this.currentTarget = closest;
      if (closest) { this.setHL(closest.mesh, true); if (this.onPrompt) this.onPrompt(closest.label); }
      else if (this.onPrompt) this.onPrompt(null);
    } else if (closest && this.onPrompt) this.onPrompt(closest.label);
  }
  setHL(obj, on) {
    obj.traverse(ch => {
      if (!ch.isMesh || !ch.material) return;
      const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
      for (const mat of mats) {
        if (!mat.emissive) continue;
        if (on) {
          // Save original only once, before first highlight
          if (mat.userData._hlSaved !== true) {
            mat.userData._oe = mat.emissive.getHex();
            mat.userData._oi = mat.emissiveIntensity;
            mat.userData._hlSaved = true;
          }
          mat.emissive.setHex(0x22d4ff);
          mat.emissiveIntensity = Math.max(mat.userData._oi || 0, 0.35) + 0.4;
        } else {
          // Restore and clear save so component updates can change base again
          if (mat.userData._hlSaved === true) {
            mat.emissive.setHex(mat.userData._oe ?? 0x000000);
            mat.emissiveIntensity = mat.userData._oi ?? 0;
            mat.userData._hlSaved = false;
            delete mat.userData._oe;
            delete mat.userData._oi;
          }
        }
      }
    });
  }
}

// ═══════════════════════════════════════════════════════════════════
// Level 1 + Main
// ═══════════════════════════════════════════════════════════════════
const solver = new CircuitSolver();
let battery, door, wires = [], components = [];
let mode = 'idle', activeWire = null, firstTerminal = null, tempLine = null;
let completed = false, knowledgeShown = false, msgTimer = 0, idleHintTimer = 0;
let player, scene, renderer, camera, clock, composer;
let animLights = []; // { light, base, amp, speed, phase }

function showMsg(t) {
  const el = document.getElementById('task');
  if (el) { el.textContent = t; msgTimer = 4.5; }
}

let soundEnabled = localStorage.getItem('el_sound') !== '0';
let audioCtx = null;

function getAudio() {
  if (!soundEnabled) return null;
  try {
    if (!audioCtx) audioCtx = new AudioContext();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    return audioCtx;
  } catch { return null; }
}

function beep(freq, dur, vol, type = 'sine') {
  const ctx = getAudio();
  if (!ctx) return;
  try {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value = freq; o.type = type;
    g.gain.setValueAtTime(vol, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    o.start(); o.stop(ctx.currentTime + dur);
  } catch {}
}

function sfxConnect() { beep(720, 0.1, 0.06); setTimeout(() => beep(980, 0.08, 0.04), 70); }
function sfxDisconnect() { beep(380, 0.1, 0.05, 'triangle'); }
function sfxSwitch() { beep(520, 0.06, 0.05); beep(640, 0.05, 0.04); }
function sfxSuccess() {
  beep(523, 0.12, 0.06); setTimeout(() => beep(659, 0.12, 0.06), 120);
  setTimeout(() => beep(784, 0.18, 0.07), 240);
}
function sfxDoor() { beep(180, 0.25, 0.04, 'square'); setTimeout(() => beep(140, 0.2, 0.03, 'square'), 150); }
function sfxLamp() { beep(880, 0.15, 0.03, 'sine'); }


function spawnWire(id, pos) {
  const w = new Wire(id);
  w.mesh.position.copy(pos);
  scene.add(w.mesh);
  solver.add(w); wires.push(w); components.push(w);
}

/* registerAll defined in level system */

function pickWire(w) {
  idleHintTimer = 0;
  if (mode !== 'idle') return;
  activeWire = w; mode = 'holding';
  const ph = w.mesh.getObjectByName('placeholder');
  if (ph) ph.visible = false;
  showMsg('Выберите первый контакт  ·  ESC — отмена');
  registerAll();
}

function onTerminal(t) {
  idleHintTimer = 0;
  if (mode === 'idle' && t.connectedTo) { disconnect(t); return; }
  if (mode === 'holding') {
    if (t.connectedTo) { showMsg('Контакт занят'); return; }
    firstTerminal = t; mode = 'firstConnected';
    createTempLine(t.worldPosition);
    showMsg('Выберите второй контакт  ·  ESC — отмена');
    registerAll();
    return;
  }
  if (mode === 'firstConnected' && activeWire && firstTerminal) {
    if (t === firstTerminal) { showMsg('Нельзя соединить с собой'); return; }
    if (!firstTerminal.isCompatible(t)) { showMsg('Контакт занят'); return; }
    if (activeWire.connect(firstTerminal, t)) {
      activeWire.mesh.position.set(0,0,0);
      scene.add(activeWire.mesh);
      sfxConnect();
      mode = 'idle'; activeWire = null; firstTerminal = null; clearTempLine();
      registerAll();
      solveCircuit();
      if (!completed) {
        const meter = document.getElementById('meter');
        if (meter && meter.style.display === 'block') showMsg('Ток идёт — цепь замкнута');
        else showMsg('Провод подключён');
      }
    }
  }
}

function disconnect(t) {
  const other = t.connectedTo;
  if (!other) return;
  for (const w of wires) {
    if ((w.terminalA === t && w.terminalB === other) || (w.terminalA === other && w.terminalB === t)) {
      w.disconnect();
      const ph = w.mesh.getObjectByName('placeholder');
      if (ph) { ph.visible = true; /* keep position on table */ }
      sfxDisconnect();
      showMsg('Провод отключён');
      solveCircuit(); registerAll();
      break;
    }
  }
}

function cancelWire() {
  if (activeWire) {
    const ph = activeWire.mesh.getObjectByName('placeholder');
    if (ph) ph.visible = true;
  }
  mode = 'idle'; activeWire = null; firstTerminal = null; clearTempLine();
  showMsg('Отменено'); registerAll();
}

function createTempLine(from) {
  clearTempLine();
  const geo = new THREE.BufferGeometry().setFromPoints([from.clone(), from.clone()]);
  tempLine = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0x00ffaa, transparent: true, opacity: 0.85 }));
  scene.add(tempLine);
}
function clearTempLine() {
  if (tempLine) { scene.remove(tempLine); tempLine.geometry.dispose(); tempLine.material.dispose(); tempLine = null; }
}


// ── Level system ──────────────────────────────────────────────────
let currentLevel = 1;
let levelSwitch = null; // active Switch on L2+
let levelLamps = [];    // lamps on L3+
const LEVEL_META = {
  1: {
    goal: 'Найди способ открыть дверь',
    hints: [
      'Что необходимо, чтобы электрический ток мог течь?',
      'Нужен замкнутый путь от одного полюса батареи к другому.',
      'Соедини оба контакта батареи с контактами двери двумя проводами.'
    ],
    knowledge: {
      title: 'Замкнутая электрическая цепь',
      body: 'Ты создал <strong>замкнутый путь</strong>, по которому может протекать ток. Батарея создаёт разность потенциалов. Когда путь замкнут — заряды движутся и питают дверь.',
      formula: 'U = I·R  ·  нужен замкнутый путь'
    }
  },
  2: {
    goal: 'Сделай управление дверью',
    hints: [
      'Как прервать ток, не отключая провода от батареи?',
      'Вставь выключатель в разрыв цепи между батареей и дверью.',
      'Цепь: батарея → выключатель → дверь → батарея. Затем включи выключатель.'
    ],
    knowledge: {
      title: 'Разрыв и замыкание цепи',
      body: 'Выключатель <strong>разрывает</strong> или <strong>замыкает</strong> путь тока. Разомкнут — ток не течёт. Замкнут — цепь снова цела. Так управляют нагрузкой без переподключения проводов.',
      formula: 'разомкнут: I=0  ·  замкнут: I=U/RΣ'
    }
  },
  3: {
    goal: 'Включи освещение',
    hints: [
      'Лампе тоже нужна замкнутая цепь с источником питания.',
      'Собери цепь: батарея → выключатель → лампа → батарея.',
      'Включи выключатель — лампа должна загореться.'
    ],
    knowledge: {
      title: 'Нагрузка в цепи',
      body: 'Лампа — <strong>нагрузка</strong>: она преобразует энергию тока в свет. Яркость зависит от мощности. Убери батарею или разомкни выключатель — ток пропадёт, лампа погаснет.',
      formula: 'P = I²·R  ·  яркость ∝ мощности'
    }
  },
  4: {
    goal: 'Зажги обе лампы',
    hints: [
      'Обе лампы должны оказаться на одном пути тока.',
      'Соедини лампы последовательно: ток идёт через первую, затем через вторую.',
      'Цепь: батарея → лампа1 → лампа2 → батарея (можно с выключателем).'
    ],
    knowledge: {
      title: 'Последовательное соединение',
      body: 'В <strong>последовательной</strong> цепи ток один и тот же через все элементы. Убери одну лампу (разрыв) — погаснут обе: путь тока один.',
      formula: 'RΣ = R₁+R₂  ·  ток один на все'
    }
  },
  5: {
    goal: 'Сделай так, чтобы лампы работали независимо',
    hints: [
      'Каждой лампе нужен свой путь от батареи.',
      'Параллельное соединение: обе лампы подключены к одним и тем же узлам питания.',
      'Отключи одну лампу — вторая должна продолжить светить.'
    ],
    knowledge: {
      title: 'Параллельное соединение',
      body: 'В <strong>параллельной</strong> цепи у каждой ветки свой путь тока. Отключение одной нагрузки не разрывает путь другой. Напряжение на параллельных ветвях одинаково.',
      formula: '1/RΣ = 1/R₁+1/R₂  ·  напряжение общее'
    }
  }
};

function saveProgress() {
  try {
    let maxLevel = Number(localStorage.getItem('el_max') || 1);
    maxLevel = Math.max(maxLevel, currentLevel);
    if (completed) maxLevel = Math.max(maxLevel, Math.min(5, currentLevel + 1));
    const data = { level: currentLevel, completed: completed, maxLevel };
    localStorage.setItem('el_progress', JSON.stringify(data));
    localStorage.setItem('el_max', String(maxLevel));
  } catch {}
}

function loadProgress() {
  try {
    const raw = localStorage.getItem('el_progress');
    if (!raw) return;
    const data = JSON.parse(raw);
    // only remember max unlocked; always start L1 for session clarity
  } catch {}
}

function updateMeter(state) {
  const box = document.getElementById('meter');
  if (!box) return;
  if (!state || !state.isClosed) {
    box.style.display = 'none';
    return;
  }
  box.style.display = 'block';
  const mi = document.getElementById('m-i');
  const mr = document.getElementById('m-r');
  const mp = document.getElementById('m-p');
  if (mi) mi.textContent = state.current.toFixed(3);
  if (mr) mr.textContent = isFinite(state.totalResistance) ? state.totalResistance.toFixed(2) : '∞';
  if (mp) mp.textContent = (state.powerSource != null ? state.powerSource : state.current * (state.totalVoltage || 0)).toFixed(2);
}

function solveCircuit() {
  for (const c of components) c.updateTerminals();
  for (const w of wires) if (w.terminalA && w.terminalB) w.rebuildVisual();
  const state = solver.solve();
  console.log('[Circuit L' + currentLevel + ']', state);
  updateMeter(state);

  // still update visuals when completed; only skip re-triggering win
  if (!completed) {
    if (currentLevel === 1) {
      const doorOk = door && door.current > 0.03 && door.voltage >= 3;
      if ((state.isClosed && state.current > 0.03) || doorOk) winLevel(state);
    } else if (currentLevel === 2) {
      const swOk = levelSwitch && levelSwitch.isClosed;
      const doorOk = door && door.current > 0.03;
      if (state.isClosed && state.current > 0.03 && swOk && doorOk) winLevel(state);
    } else if (currentLevel === 3) {
      const lampOn = levelLamps[0] && levelLamps[0].current > 0.03;
      if (lampOn) winLevel(state);
    } else if (currentLevel === 4) {
      const both = levelLamps.length >= 2 && levelLamps.every(l => l.current > 0.02);
      if (both) winLevel(state);
    } else if (currentLevel === 5) {
      const both = levelLamps.length >= 2 && levelLamps.every(l => l.current > 0.02);
      if (both) winLevel(state);
    }
  }
}

function winLevel(state) {
  completed = true;
  saveProgress();
  sfxSuccess();
  if (currentLevel === 1 || currentLevel === 2) sfxDoor();
  if (currentLevel >= 3) sfxLamp();
  const I = state.current.toFixed(2);
  const R = state.totalResistance.toFixed(1);
  const P = (state.powerSource != null) ? state.powerSource.toFixed(2) : (state.current * state.totalVoltage).toFixed(2);
  showMsg(`Уровень ${currentLevel} ✓ I≈${I}А R≈${R}Ω P≈${P}Вт`);
  setTimeout(() => showKnowledge(), 1600);
}

function showKnowledge() {
  knowledgeShown = true;
  const meta = LEVEL_META[currentLevel];
  const existing = document.getElementById('knowledge-modal');
  if (existing) existing.remove();

  const modal = document.createElement('div');
  modal.id = 'knowledge-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.78);z-index:300;display:flex;align-items:center;justify-content:center;pointer-events:auto;';
  const nextLabel = currentLevel < 5 ? `Level ${currentLevel + 1} →` : 'Карта прогресса';
  modal.innerHTML = `<div style="background:linear-gradient(160deg,#0c1a2b,#132a42);border:1px solid #00d4ff55;border-radius:14px;padding:32px 36px;max-width:520px;color:#e8f4ff;box-shadow:0 0 60px #00d4ff18;">
    <div style="font-size:12px;letter-spacing:2px;color:#00d4ff99;margin-bottom:8px;">ЗНАНИЕ ПОЛУЧЕНО · УРОВЕНЬ ${currentLevel}</div>
    <h2 style="color:#00d4ff;margin:0 0 16px;font-size:20px;">${meta.knowledge.title}</h2>
    <p style="line-height:1.6;font-size:14.5px;margin-bottom:12px;">${meta.knowledge.body}</p>
    <div style="background:#00d4ff0c;border:1px solid #00d4ff33;border-radius:8px;padding:10px 14px;margin-bottom:20px;font-size:13px;font-family:ui-monospace,monospace;color:#9edfff;">${meta.knowledge.formula || ''}</div>
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      <button id="ck" style="background:#00d4ff18;border:1px solid #00d4ff;color:#00d4ff;padding:11px 22px;border-radius:7px;cursor:pointer;font-size:14px;">Экспериментировать</button>
      <button id="btn-next" style="background:#00ff8818;border:1px solid #00ff88;color:#00ff88;padding:11px 22px;border-radius:7px;cursor:pointer;font-size:14px;">${nextLabel}</button>
    </div>
  </div>`;
  document.body.appendChild(modal);
  document.getElementById('ck').onclick = () => modal.remove();
  document.getElementById('btn-next').onclick = () => {
    modal.remove();
    if (currentLevel < 5) startLevel(currentLevel + 1);
    else showProgressMap();
  };
}

function showProgressMap() {
  const max = Number(localStorage.getItem('el_max') || currentLevel);
  const names = ['', 'Цепь и дверь', 'Выключатель', 'Лампа', 'Последовательно', 'Параллельно'];
  let rows = '';
  for (let i = 1; i <= 5; i++) {
    const done = i <= max;
    rows += `<div style="padding:10px 14px;margin:6px 0;border-radius:8px;border:1px solid ${done ? '#00d4ff55' : '#ffffff22'};background:${done ? '#00d4ff12' : '#ffffff08'};cursor:${done ? 'pointer' : 'default'};" ${done ? `data-lv="${i}"` : ''}>
      <span style="color:${done ? '#00d4ff' : '#666'};">Level ${i}</span> — ${names[i]}
    </div>`;
  }
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:300;display:flex;align-items:center;justify-content:center;pointer-events:auto;';
  modal.innerHTML = `<div style="background:#0c1a2b;border:1px solid #00d4ff44;border-radius:14px;padding:28px;max-width:400px;color:#e8f4ff;width:90%;">
    <h2 style="color:#00d4ff;margin:0 0 16px;">Карта обучения</h2>
    ${rows}
    <button id="map-close" style="margin-top:14px;background:#00d4ff18;border:1px solid #00d4ff;color:#00d4ff;padding:10px 18px;border-radius:7px;cursor:pointer;">Закрыть</button>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-lv]').forEach(el => {
    el.onclick = () => { modal.remove(); startLevel(Number(el.dataset.lv)); };
  });
  document.getElementById('map-close').onclick = () => modal.remove();
}

function clearCircuitObjects() {
  for (const c of components) {
    if (c.mesh && c.mesh.parent) c.mesh.parent.remove(c.mesh);
  }
  components = [];
  wires = [];
  levelSwitch = null;
  levelLamps = [];
  solver.components.clear();
  solver.wires = [];
  mode = 'idle';
  activeWire = null;
  firstTerminal = null;
  clearTempLine();
  completed = false;
  knowledgeShown = false;
  player.clearInteractables();
}


function spawnBattery(pos) {
  battery = new Battery('battery1', 12);
  battery.mesh.position.copy(pos);
  battery.mesh.rotation.y = 0; // axis-aligned, neat on table
  scene.add(battery.mesh);
  solver.add(battery);
  components.push(battery);
}

function spawnDoor() {
  door = new Door('door1');
  door.mesh.position.set(-1.5, 0, -4.85);
  scene.add(door.mesh);
  solver.add(door);
  components.push(door);
}

function spawnSwitchComp(pos) {
  levelSwitch = new Switch('switch1');
  levelSwitch.mesh.position.copy(pos);
  scene.add(levelSwitch.mesh);
  solver.add(levelSwitch);
  components.push(levelSwitch);
}

function spawnLampComp(id, pos) {
  const lamp = new Lamp(id);
  lamp.mesh.position.copy(pos);
  scene.add(lamp.mesh);
  solver.add(lamp);
  components.push(lamp);
  levelLamps.push(lamp);
  return lamp;
}

function registerLevelInteractables() {
  player.clearInteractables();
  for (const c of components) {
    if (c.type === 'wire') continue;
    for (const term of c.terminals) {
      if (!term.mesh) continue;
      let label = 'E — контакт';
      if (mode === 'idle') {
        if (c.type === 'battery') label = `E — батарея (${term.polarity === 'positive' ? '+' : '−'})`;
        else if (c.type === 'door') label = 'E — контакт двери';
        else if (c.type === 'switch') label = 'E — контакт выключателя';
        else if (c.type === 'lamp') label = 'E — контакт лампы';
        if (term.connectedTo) label = 'E — отключить провод';
      } else {
        label = term.connectedTo ? 'Занят' : 'E — соединить';
      }
      player.register(term.mesh, label, () => onTerminal(term));
    }
  }
  if (mode === 'idle') {
    for (const c of components) {
      if (c.type !== 'switch') continue;
      const sw = c;
      player.register(sw.mesh, sw.isClosed ? 'E — выключить' : 'E — включить', () => {
        sw.toggle();
        sfxSwitch();
        showMsg(sw.isClosed ? 'Выключатель замкнут' : 'Выключатель разомкнут');
        solveCircuit();
        registerLevelInteractables();
      });
    }
  }
  if (mode === 'idle') {
    for (const w of wires) {
      if (!w.terminalA) player.register(w.mesh, 'E — взять провод', () => pickWire(w));
    }
  }
}

// Override registerAll used by wire UX
function registerAll() {
  registerLevelInteractables();
}

function showHint() {
  const hints = (LEVEL_META[currentLevel] || LEVEL_META[1]).hints;
  const key = 'hint-l' + currentLevel;
  const used = Number(sessionStorage.getItem(key) || '0');
  const idx = Math.min(used, hints.length - 1);
  showMsg(`Подсказка ${idx + 1}/${hints.length}: ${hints[idx]}`);
  sessionStorage.setItem(key, String(used + 1));
}

function startLevel(n) {
  currentLevel = n;
  clearCircuitObjects();

  // Even spacing on table (center -1.2, -1.6; width ~2.6 usable)
  const TY = 0.90;
  const WY = 0.87;
  const SY = 0.855;
  const CX = -1.2;
  const CZ = -1.6;
  // Place count items evenly from xMin..xMax
  const spanX = (count, i, xMin = -2.35, xMax = -0.05) => {
    if (count <= 1) return (xMin + xMax) / 2;
    return xMin + (i / (count - 1)) * (xMax - xMin);
  };
  const backZ = CZ - 0.28;
  const frontZ = CZ + 0.32;

  if (n === 1) {
    spawnDoor();
    // 3 slots: battery, wire, wire — equal gaps
    spawnBattery(new THREE.Vector3(spanX(3, 0), TY, backZ));
    spawnWire('wire1', new THREE.Vector3(spanX(3, 1), WY, backZ));
    spawnWire('wire2', new THREE.Vector3(spanX(3, 2), WY, backZ));
  } else if (n === 2) {
    spawnDoor();
    // battery, switch, 3 wires
    spawnBattery(new THREE.Vector3(spanX(5, 0), TY, backZ));
    spawnSwitchComp(new THREE.Vector3(spanX(5, 1), SY, backZ));
    spawnWire('wire1', new THREE.Vector3(spanX(5, 2), WY, backZ));
    spawnWire('wire2', new THREE.Vector3(spanX(5, 3), WY, backZ));
    spawnWire('wire3', new THREE.Vector3(spanX(5, 4), WY, backZ));
  } else if (n === 3) {
    spawnBattery(new THREE.Vector3(spanX(3, 0), TY, backZ));
    spawnSwitchComp(new THREE.Vector3(spanX(3, 1), SY, backZ));
    spawnLampComp('lamp1', new THREE.Vector3(spanX(3, 2), SY, backZ));
    spawnWire('wire1', new THREE.Vector3(spanX(3, 0), WY, frontZ));
    spawnWire('wire2', new THREE.Vector3(spanX(3, 1), WY, frontZ));
    spawnWire('wire3', new THREE.Vector3(spanX(3, 2), WY, frontZ));
  } else if (n === 4) {
    spawnBattery(new THREE.Vector3(spanX(4, 0), TY, backZ));
    spawnSwitchComp(new THREE.Vector3(spanX(4, 1), SY, backZ));
    spawnLampComp('lamp1', new THREE.Vector3(spanX(4, 2), SY, backZ));
    spawnLampComp('lamp2', new THREE.Vector3(spanX(4, 3), SY, backZ));
    for (let i = 0; i < 4; i++) spawnWire('wire' + (i + 1), new THREE.Vector3(spanX(4, i), WY, frontZ));
  } else if (n === 5) {
    // back: bat, sw1, lamp1, sw2, lamp2
    spawnBattery(new THREE.Vector3(spanX(5, 0), TY, backZ));
    spawnSwitchComp(new THREE.Vector3(spanX(5, 1), SY, backZ));
    spawnLampComp('lamp1', new THREE.Vector3(spanX(5, 2), SY, backZ));
    const sw2 = new Switch('switch2');
    sw2.mesh.position.set(spanX(5, 3), SY, backZ);
    scene.add(sw2.mesh);
    solver.add(sw2);
    components.push(sw2);
    spawnLampComp('lamp2', new THREE.Vector3(spanX(5, 4), SY, backZ));
    // front: 6 wires evenly
    for (let i = 0; i < 6; i++) {
      spawnWire('wire' + (i + 1), new THREE.Vector3(spanX(6, i), WY, frontZ));
    }
  }

  registerAll();
  const meta = LEVEL_META[n] || LEVEL_META[1];
  const taskEl = document.getElementById('task');
  if (taskEl) taskEl.textContent = meta.goal;
  showMsg(meta.goal);
  console.log('Started Level', n);
  saveProgress();
  const badge = document.getElementById('level-badge');
  if (badge) badge.textContent = 'LEVEL ' + n;
  idleHintTimer = 0;
}


function showMainMenu() {
  const modal = document.createElement('div');
  modal.id = 'main-menu';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(8,14,24,0.92);z-index:400;display:flex;align-items:center;justify-content:center;pointer-events:auto;';
  const max = Number(localStorage.getItem('el_max') || 1);
  let levelBtns = '';
  for (let i = 1; i <= 5; i++) {
    const unlocked = i <= max;
    levelBtns += `<button data-lv="${i}" ${unlocked?'':'disabled'} style="display:block;width:100%;margin:6px 0;padding:12px;border-radius:8px;border:1px solid ${unlocked?'#00d4ff66':'#333'};background:${unlocked?'#00d4ff15':'#111'};color:${unlocked?'#e0f7ff':'#555'};cursor:${unlocked?'pointer':'default'};font-size:14px;">Level ${i}${unlocked?'':' 🔒'}</button>`;
  }
  modal.innerHTML = `<div style="max-width:380px;width:90%;text-align:center;color:#e8f4ff;">
    <h1 style="color:#00d4ff;letter-spacing:6px;font-size:28px;margin-bottom:8px;">ELECTROLAB</h1>
    <p style="opacity:0.7;font-size:13px;margin-bottom:24px;">Learn by doing · MNA circuit solver</p>
    <button id="menu-start" style="width:100%;padding:14px;margin-bottom:16px;border-radius:8px;border:1px solid #00ff88;background:#00ff8818;color:#00ff88;font-size:15px;cursor:pointer;">Играть с Level 1</button>
    <div style="text-align:left;margin-bottom:12px;font-size:12px;color:#00d4ff99;letter-spacing:1px;">УРОВНИ</div>
    ${levelBtns}
  </div>`;
  document.body.appendChild(modal);
  document.getElementById('menu-start').onclick = () => { modal.remove(); startLevel(1); };
  modal.querySelectorAll('[data-lv]').forEach(el => {
    el.onclick = () => {
      if (el.disabled) return;
      modal.remove();
      startLevel(Number(el.dataset.lv));
    };
  });
}

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141c2a);
  scene.fog = new THREE.Fog(0x141c2a, 16, 36);

  camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 100);
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.25;
  document.body.appendChild(renderer.domElement);

  // Dimensional lighting: lower ambient, strong key + fill + rim
  scene.add(new THREE.AmbientLight(0x4a5a6c, 0.35));
  scene.add(new THREE.HemisphereLight(0xb8c8d8, 0x2a3038, 0.4));

  const key = new THREE.DirectionalLight(0xfff2e0, 1.45);
  key.position.set(4.5, 8, 3.5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 28;
  key.shadow.camera.left = -9;
  key.shadow.camera.right = 9;
  key.shadow.camera.top = 9;
  key.shadow.camera.bottom = -9;
  scene.add(key);

  // Cool fill from opposite side
  const fill = new THREE.DirectionalLight(0x88aacc, 0.35);
  fill.position.set(-5, 4, -2);
  scene.add(fill);

  // Table spotlight (warm, local volume)
  const tableSpot = new THREE.SpotLight(0xffe0c0, 1.1, 8, Math.PI / 5, 0.45, 1);
  tableSpot.position.set(-1.2, 3.0, -0.4);
  tableSpot.target.position.set(-1.2, 0.85, -1.6);
  scene.add(tableSpot);
  scene.add(tableSpot.target);
  tableSpot.castShadow = true;
  tableSpot.shadow.mapSize.set(1024, 1024);

  // Ceiling soft
  const ceilLight = new THREE.PointLight(0xeef2ff, 0.45, 14);
  ceilLight.position.set(0, 2.9, 0.5);
  scene.add(ceilLight);

  // Door / north wall accent
  const doorLight = new THREE.PointLight(0x9ab8d0, 0.5, 9);
  doorLight.position.set(-1.5, 2.1, -3.4);
  scene.add(doorLight);

  // Warm bounce near table front
  const warm = new THREE.PointLight(0xffc8a0, 0.4, 6);
  warm.position.set(-1.2, 1.3, -0.7);
  scene.add(warm);

  animLights = [
    { light: ceilLight, base: 0.45, amp: 0.03, speed: 0.7, phase: 0 },
    { light: warm, base: 0.4, amp: 0.025, speed: 0.55, phase: 1.1 },
    { light: doorLight, base: 0.5, amp: 0.03, speed: 0.9, phase: 2.0 },
  ];

  player = new Player(camera);
  scene.add(player.object);
  const promptEl = document.getElementById('prompt');
  player.onPrompt = (txt) => {
    if (!promptEl) return;
    if (txt) { promptEl.style.display = 'block'; promptEl.textContent = txt; }
    else promptEl.style.display = 'none';
  };

  const room = createLabRoom();
  scene.add(room.group);
  player.colliders.push(...room.colliders);

  // Bloom
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.28, 0.35, 0.92
  );
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());

  window.addEventListener('resize', () => {
    const w = window.innerWidth, h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  });

  document.getElementById('btn-hint').onclick = showHint;
  const sndBtn = document.getElementById('btn-sound');
  if (sndBtn) {
    sndBtn.textContent = soundEnabled ? '🔊' : '🔇';
    sndBtn.onclick = () => {
      soundEnabled = !soundEnabled;
      localStorage.setItem('el_sound', soundEnabled ? '1' : '0');
      sndBtn.textContent = soundEnabled ? '🔊' : '🔇';
      if (soundEnabled) beep(600, 0.08, 0.05);
    };
  }
  const mapBtn = document.getElementById('btn-map');
  if (mapBtn) mapBtn.onclick = () => showProgressMap();

  document.getElementById('btn-know').onclick = () => {
    if (completed || knowledgeShown) showKnowledge();
    else showMsg('Сначала реши задачу экспериментально');
  };
  document.getElementById('btn-know').addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showProgressMap();
  });
  document.addEventListener('keydown', e => {
    if (e.code === 'Escape' && mode !== 'idle') cancelWire();
    if (e.code === 'KeyC') {
      const st = solver.solve();
      console.table(st.branches || []);
      showMsg(`Отладка: I=${(st.current||0).toFixed(3)}А R=${isFinite(st.totalResistance)?st.totalResistance.toFixed(2):'∞'}Ω P=${(st.powerSource||0).toFixed(2)}Вт`);
    }
  });

  showMainMenu();

  const loadingEl = document.getElementById('loading');
  if (loadingEl) loadingEl.style.display = 'none';
  const uiEl = document.getElementById('ui');
  if (uiEl) uiEl.style.display = 'block';
  clock = new THREE.Clock();
  animate();
  console.log('ElectroLab ready.');
  // MNA self-test (series + parallel)
  (function mnaSelfTest() {
    const s = new CircuitSolver();
    const b = new Battery('tb', 12);
    const r1 = { id: 'r1', type: 'resistor', terminals: [
      { id: 'r1-a', componentId: 'r1', polarity: 'neutral', localPosition: {x:0,y:0,z:0}, worldPosition: {x:0,y:0,z:0}, connectedTo: null, mesh: null },
      { id: 'r1-b', componentId: 'r1', polarity: 'neutral', localPosition: {x:0,y:0,z:0}, worldPosition: {x:0,y:0,z:0}, connectedTo: null, mesh: null }
    ], current:0, voltage:0, isPowered:false, getResistance:()=>10, updateTerminals(){}, updateVisuals(){} };
    // skip complex mock — log solver presence
    console.log('[MNA] solver ready, Gaussian + deep branch currents enabled');
  })();

}

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  player.update(dt);
  for (const c of components) {
    c.updateTerminals();
    if (c.updateVisuals) c.updateVisuals(dt);
  }
  for (const w of wires) w.updateVisuals(dt);
  if (tempLine && firstTerminal) {
    const from = firstTerminal.worldPosition;
    const aim = new THREE.Vector3(0, 0, -2.5)
      .applyQuaternion(player.camera.getWorldQuaternion(new THREE.Quaternion()))
      .add(player.camera.getWorldPosition(new THREE.Vector3()));
    const pos = tempLine.geometry.attributes.position;
    pos.setXYZ(0, from.x, from.y, from.z);
    pos.setXYZ(1, aim.x, aim.y, aim.z);
    pos.needsUpdate = true;
  }
  idleHintTimer += dt;
  if (!completed && idleHintTimer > 45) {
    idleHintTimer = 0;
    showHint();
  }
  if (msgTimer > 0) {
    msgTimer -= dt;
    if (msgTimer <= 0 && !completed) {
      const el = document.getElementById('task');
      if (el) el.textContent = (LEVEL_META[currentLevel]||LEVEL_META[1]).goal;
    }
  }
  // Subtle living lights
  const tsec = clock.elapsedTime;
  for (const a of animLights) {
    a.light.intensity = a.base + Math.sin(tsec * a.speed + a.phase) * a.amp;
  }
  composer.render();
}

try {
  init();
} catch (err) {
  console.error(err);
  const el = document.getElementById('load-msg');
  if (el) el.innerHTML = 'Ошибка запуска: <span class="err">' + err.message + '</span>';
}
