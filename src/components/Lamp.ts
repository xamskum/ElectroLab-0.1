/**
 * Lamp — resistance load, brightness from power P = I²R
 */

import * as THREE from 'three';
import { ElectricalComponent } from '../electricity/ElectricalComponent';
import { Terminal } from '../electricity/Terminal';

export class Lamp extends ElectricalComponent {
  public resistanceValue = 24;
  private bulb: THREE.Mesh;
  private glow: THREE.Mesh;

  constructor(id: string, resistance = 24) {
    const group = new THREE.Group();
    this.resistanceValue = resistance;

    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.08, 0.1, 0.12, 12),
      new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.6, roughness: 0.4 })
    );
    base.position.y = 0.06;
    group.add(base);

    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(0.1, 16, 16),
      new THREE.MeshStandardMaterial({
        color: 0x888888, emissive: 0x000000, emissiveIntensity: 0,
        transparent: true, opacity: 0.9, roughness: 0.2,
      })
    );
    bulb.position.y = 0.2;
    group.add(bulb);

    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.14, 12, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffee88, transparent: true, opacity: 0, depthWrite: false,
      })
    );
    glow.position.y = 0.2;
    group.add(glow);

    super(id, 'lamp', group);
    this.bulb = bulb;
    this.glow = glow;

    const tA = new Terminal(`${id}-a`, id, 'neutral', new THREE.Vector3(-0.12, 0.05, 0));
    const tB = new Terminal(`${id}-b`, id, 'neutral', new THREE.Vector3(0.12, 0.05, 0));
    this.terminals.push(tA, tB);
    for (const t of this.terminals) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.025, 10, 10),
        new THREE.MeshStandardMaterial({ color: 0x00aaff, emissive: 0x0066aa, emissiveIntensity: 0.3 })
      );
      s.position.copy(t.localPosition);
      group.add(s);
      t.mesh = s;
    }
  }

  getResistance(): number {
    return this.resistanceValue;
  }

  updateVisuals(_dt: number): void {
    // Brightness from power
    const P = this.current * this.current * this.resistanceValue;
    const level = Math.min(1, P / 8); // ~8W full bright for 12V/24ohm ~6W
    const mat = this.bulb.material as THREE.MeshStandardMaterial;
    mat.emissive.setHex(0xffeeaa);
    mat.emissiveIntensity = level * 2.5;
    mat.color.setHex(level > 0.05 ? 0xfff5d0 : 0x666666);
    (this.glow.material as THREE.MeshBasicMaterial).opacity = level * 0.35;
  }
}
