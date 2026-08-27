import * as THREE from 'three';
import { ElectricalComponent } from '../electricity/ElectricalComponent';
import { Terminal } from '../electricity/Terminal';

export class Resistor extends ElectricalComponent {
  public resistanceValue: number;

  constructor(id: string, resistance = 10) {
    const group = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.28, 12),
      new THREE.MeshStandardMaterial({ color: 0xc4a574, roughness: 0.6, metalness: 0.15 })
    );
    body.rotation.z = Math.PI / 2;
    group.add(body);
    [0xff0000, 0x000000, 0x884400].forEach((col, i) => {
      const band = new THREE.Mesh(
        new THREE.CylinderGeometry(0.052, 0.052, 0.025, 12),
        new THREE.MeshStandardMaterial({ color: col })
      );
      band.rotation.z = Math.PI / 2;
      band.position.x = -0.06 + i * 0.06;
      group.add(band);
    });
    super(id, 'resistor', group);
    this.resistanceValue = resistance;
    const tA = new Terminal(`${id}-a`, id, 'neutral', new THREE.Vector3(-0.16, 0, 0));
    const tB = new Terminal(`${id}-b`, id, 'neutral', new THREE.Vector3(0.16, 0, 0));
    this.terminals.push(tA, tB);
    for (const t of this.terminals) {
      const s = new THREE.Mesh(
        new THREE.SphereGeometry(0.028, 10, 10),
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
}
