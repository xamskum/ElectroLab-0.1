/**
 * Electrical door — opens only when it receives sufficient voltage & current.
 * Opening is driven by real CircuitSolver state, not by scripted events.
 */

import * as THREE from 'three';
import { ElectricalComponent } from '../electricity/ElectricalComponent';
import { Terminal } from '../electricity/Terminal';

export class Door extends ElectricalComponent {
  public readonly requiredVoltage = 5;
  public isOpen = false;

  private targetOpen = 0; // 0 = closed, 1 = fully open
  private currentOpen = 0;
  private doorMesh: THREE.Mesh;
  private statusLight: THREE.Mesh;

  constructor(id: string) {
    const group = new THREE.Group();

    // ── Frame ──────────────────────────────────────────────────────
    const frameMat = new THREE.MeshStandardMaterial({
      color: 0x2a3a4a,
      metalness: 0.65,
      roughness: 0.35,
    });

    const left = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.4, 0.18), frameMat);
    left.position.set(-0.72, 1.2, 0);
    left.castShadow = true;
    group.add(left);

    const right = new THREE.Mesh(new THREE.BoxGeometry(0.14, 2.4, 0.18), frameMat);
    right.position.set(0.72, 1.2, 0);
    right.castShadow = true;
    group.add(right);

    const top = new THREE.Mesh(new THREE.BoxGeometry(1.58, 0.14, 0.18), frameMat);
    top.position.set(0, 2.37, 0);
    top.castShadow = true;
    group.add(top);

    // ── Door panel ─────────────────────────────────────────────────
    const doorMat = new THREE.MeshStandardMaterial({
      color: 0x1a2a38,
      metalness: 0.55,
      roughness: 0.3,
      emissive: 0x001018,
      emissiveIntensity: 0.25,
    });
    this.doorMesh = new THREE.Mesh(new THREE.BoxGeometry(1.32, 2.22, 0.07), doorMat);
    this.doorMesh.position.set(0, 1.15, 0);
    this.doorMesh.castShadow = true;
    group.add(this.doorMesh);

    // Thin neon edge on door
    const edge = new THREE.Mesh(
      new THREE.BoxGeometry(1.34, 2.24, 0.02),
      new THREE.MeshStandardMaterial({
        color: 0x00aacc,
        emissive: 0x0088aa,
        emissiveIntensity: 0.15,
        transparent: true,
        opacity: 0.6,
      })
    );
    edge.position.set(0, 1.15, 0.05);
    group.add(edge);

    // ── Status LED ─────────────────────────────────────────────────
    this.statusLight = new THREE.Mesh(
      new THREE.SphereGeometry(0.055, 12, 12),
      new THREE.MeshStandardMaterial({
        color: 0xff2200,
        emissive: 0xff0000,
        emissiveIntensity: 0.9,
      })
    );
    this.statusLight.position.set(0.55, 2.05, 0.12);
    group.add(this.statusLight);

    super(id, 'door', group);

    // ── Terminals ──────────────────────────────────────────────────
    const tIn = new Terminal(`${id}-in`, id, 'neutral', new THREE.Vector3(-0.88, 1.55, 0));
    const tOut = new Terminal(`${id}-out`, id, 'neutral', new THREE.Vector3(0.88, 1.55, 0));
    this.terminals.push(tIn, tOut);

    for (const t of this.terminals) {
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.038, 12, 12),
        new THREE.MeshStandardMaterial({
          color: 0x00aaff,
          emissive: 0x0077cc,
          emissiveIntensity: 0.35,
          metalness: 0.6,
          roughness: 0.3,
        })
      );
      sphere.position.copy(t.localPosition);
      group.add(sphere);
      t.mesh = sphere;
    }
  }

  getResistance(): number {
    // Solenoid / actuator resistance
    return 18;
  }

  updateVisuals(dt: number) {
    const powered =
      this.voltage >= this.requiredVoltage && this.current > 0.04;

    this.targetOpen = powered ? 1 : 0;

    // Smooth slide-up animation
    const speed = 2.8;
    this.currentOpen += (this.targetOpen - this.currentOpen) * Math.min(1, dt * speed);
    this.doorMesh.position.y = 1.15 + this.currentOpen * 2.05;
    this.isOpen = this.currentOpen > 0.92;

    // Status light colour
    const mat = this.statusLight.material as THREE.MeshStandardMaterial;
    if (powered) {
      mat.color.setHex(0x00ff66);
      mat.emissive.setHex(0x00ff44);
      mat.emissiveIntensity = 1.3;
    } else {
      mat.color.setHex(0xff2200);
      mat.emissive.setHex(0xff0000);
      mat.emissiveIntensity = 0.85;
    }
  }
}
