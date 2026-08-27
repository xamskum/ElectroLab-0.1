/**
 * Wire — physical connection between two terminals.
 * Visual: quadratic bezier + current particles whose speed depends on real current.
 */

import * as THREE from 'three';
import { ElectricalComponent } from '../electricity/ElectricalComponent';
import { Terminal } from '../electricity/Terminal';

export class Wire extends ElectricalComponent {
  public terminalA: Terminal | null = null;
  public terminalB: Terminal | null = null;
  public resistanceValue = 0.05;

  private line: THREE.Line | null = null;
  private particles: THREE.Points | null = null;
  private particlePositions: Float32Array | null = null;
  private readonly particleCount = 14;
  private particleProgress: number[] = [];
  private curve: THREE.QuadraticBezierCurve3 | null = null;

  constructor(id: string) {
    const group = new THREE.Group();
    super(id, 'wire', group);
  }

  connect(a: Terminal, b: Terminal): boolean {
    if (!a.isCompatible(b)) return false;

    this.terminalA = a;
    this.terminalB = b;
    a.connectedTo = b;
    b.connectedTo = a;

    this.rebuildVisual();
    return true;
  }

  disconnect() {
    if (this.terminalA) this.terminalA.connectedTo = null;
    if (this.terminalB) this.terminalB.connectedTo = null;
    this.terminalA = null;
    this.terminalB = null;
    this.current = 0;
    this.isPowered = false;
    this.clearVisual();
  }

  private clearVisual() {
    if (this.line) {
      this.mesh.remove(this.line);
      this.line.geometry.dispose();
      (this.line.material as THREE.Material).dispose();
      this.line = null;
    }
    if (this.particles) {
      this.mesh.remove(this.particles);
      this.particles.geometry.dispose();
      (this.particles.material as THREE.Material).dispose();
      this.particles = null;
    }
    this.curve = null;
    this.particlePositions = null;
  }

  rebuildVisual() {
    this.clearVisual();
    if (!this.terminalA || !this.terminalB) return;

    // Force update world matrices
    this.terminalA.worldPosition.copy(this.terminalA.localPosition);
    this.terminalA.mesh?.parent?.localToWorld(this.terminalA.worldPosition);
    this.terminalB.worldPosition.copy(this.terminalB.localPosition);
    this.terminalB.mesh?.parent?.localToWorld(this.terminalB.worldPosition);

    const p1 = this.terminalA.worldPosition.clone();
    const p2 = this.terminalB.worldPosition.clone();

    const mid = p1.clone().add(p2).multiplyScalar(0.5);
    mid.y += 0.18 + Math.min(0.25, p1.distanceTo(p2) * 0.08);

    this.curve = new THREE.QuadraticBezierCurve3(p1, mid, p2);
    const points = this.curve.getPoints(24);
    const geo = new THREE.BufferGeometry().setFromPoints(points);

    const mat = new THREE.LineBasicMaterial({
      color: 0x556677,
      transparent: true,
      opacity: 0.9,
    });
    this.line = new THREE.Line(geo, mat);
    this.mesh.add(this.line);

    // Current particles
    this.particleProgress = [];
    const positions = new Float32Array(this.particleCount * 3);
    for (let i = 0; i < this.particleCount; i++) {
      this.particleProgress[i] = i / this.particleCount;
      const p = this.curve.getPoint(this.particleProgress[i]);
      positions[i * 3] = p.x;
      positions[i * 3 + 1] = p.y;
      positions[i * 3 + 2] = p.z;
    }
    this.particlePositions = positions;

    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const pMat = new THREE.PointsMaterial({
      color: 0x00ffff,
      size: 0.055,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      sizeAttenuation: true,
    });
    this.particles = new THREE.Points(pGeo, pMat);
    this.particles.visible = false;
    this.mesh.add(this.particles);
  }

  getResistance(): number {
    return this.resistanceValue;
  }

  updateVisuals(dt: number) {
    if (!this.terminalA || !this.terminalB || !this.curve || !this.particles || !this.particlePositions) {
      return;
    }

    const hasCurrent = this.current > 0.01;
    this.particles.visible = hasCurrent;

    if (this.line) {
      const mat = this.line.material as THREE.LineBasicMaterial;
      mat.color.setHex(hasCurrent ? 0x00ffaa : 0x556677);
      mat.opacity = hasCurrent ? 1.0 : 0.75;
    }

    if (!hasCurrent) return;

    // Speed scales with current (visual feedback of intensity)
    const speed = Math.min(3.0, 0.6 + this.current * 1.1);

    for (let i = 0; i < this.particleCount; i++) {
      this.particleProgress[i] = (this.particleProgress[i] + speed * dt) % 1;
      const p = this.curve.getPoint(this.particleProgress[i]);
      this.particlePositions[i * 3] = p.x;
      this.particlePositions[i * 3 + 1] = p.y;
      this.particlePositions[i * 3 + 2] = p.z;
    }
    this.particles.geometry.attributes.position.needsUpdate = true;
  }
}
