/**
 * Switch — open/closed. Open => R = Infinity (no MNA edge).
 */

import * as THREE from 'three';
import { ElectricalComponent } from '../electricity/ElectricalComponent';
import { Terminal } from '../electricity/Terminal';

export class Switch extends ElectricalComponent {
  public isClosed = false;
  private lever: THREE.Mesh;
  private led: THREE.Mesh;

  constructor(id: string) {
    const group = new THREE.Group();

    const base = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.12, 0.4),
      new THREE.MeshStandardMaterial({ color: 0x3a4a5a, metalness: 0.4, roughness: 0.4 })
    );
    base.position.y = 0.06;
    base.castShadow = true;
    group.add(base);

    const lever = new THREE.Mesh(
      new THREE.BoxGeometry(0.06, 0.22, 0.06),
      new THREE.MeshStandardMaterial({
        color: 0xcc4422, metalness: 0.5, roughness: 0.3,
        emissive: 0x441100, emissiveIntensity: 0.2,
      })
    );
    lever.position.set(0, 0.22, 0);
    lever.rotation.x = 0.5;
    group.add(lever);

    const led = new THREE.Mesh(
      new THREE.SphereGeometry(0.03, 10, 10),
      new THREE.MeshStandardMaterial({
        color: 0xff3300, emissive: 0xff0000, emissiveIntensity: 0.7,
      })
    );
    led.position.set(0.1, 0.14, 0.12);
    group.add(led);

    super(id, 'switch', group);
    this.lever = lever;
    this.led = led;

    const tA = new Terminal(`${id}-a`, id, 'neutral', new THREE.Vector3(-0.16, 0.08, 0));
    const tB = new Terminal(`${id}-b`, id, 'neutral', new THREE.Vector3(0.16, 0.08, 0));
    this.terminals.push(tA, tB);

    for (const t of this.terminals) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 10, 10),
        new THREE.MeshStandardMaterial({
          color: 0x00aaff, emissive: 0x0066aa, emissiveIntensity: 0.3,
        })
      );
      s.position.copy(t.localPosition);
      group.add(s);
      t.mesh = s;
    }
  }

  getResistance(): number {
    return this.isClosed ? 0.02 : Infinity;
  }

  toggle(): void {
    this.isClosed = !this.isClosed;
    this.lever.rotation.x = this.isClosed ? -0.45 : 0.5;
    const mat = this.led.material as THREE.MeshStandardMaterial;
    if (this.isClosed) {
      mat.color.setHex(0x00ff66);
      mat.emissive.setHex(0x00ff44);
      mat.emissiveIntensity = 1.1;
    } else {
      mat.color.setHex(0xff3300);
      mat.emissive.setHex(0xff0000);
      mat.emissiveIntensity = 0.7;
    }
  }
}
