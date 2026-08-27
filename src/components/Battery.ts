/**
 * Battery — ideal voltage source with small internal resistance.
 */

import * as THREE from 'three';
import { ElectricalComponent } from '../electricity/ElectricalComponent';
import { Terminal } from '../electricity/Terminal';

export class Battery extends ElectricalComponent {
  public readonly voltageValue: number;

  constructor(id: string, voltage = 12) {
    const group = new THREE.Group();

    // Body
    const body = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.11, 0.38, 18),
      new THREE.MeshStandardMaterial({
        color: 0x1a1a1a,
        roughness: 0.35,
        metalness: 0.55,
      })
    );
    body.rotation.z = Math.PI / 2;
    body.castShadow = true;
    group.add(body);

    // Positive cap
    const posCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, 0.07, 12),
      new THREE.MeshStandardMaterial({
        color: 0xff3333,
        emissive: 0xcc0000,
        emissiveIntensity: 0.35,
      })
    );
    posCap.position.set(0.22, 0, 0);
    posCap.rotation.z = Math.PI / 2;
    group.add(posCap);

    // Negative end
    const negCap = new THREE.Mesh(
      new THREE.CylinderGeometry(0.045, 0.045, 0.04, 12),
      new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.7 })
    );
    negCap.position.set(-0.21, 0, 0);
    negCap.rotation.z = Math.PI / 2;
    group.add(negCap);

    // Label plate
    const label = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.16, 0.01),
      new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.6 })
    );
    label.position.set(0, 0.125, 0);
    group.add(label);

    super(id, 'battery', group);
    this.voltageValue = voltage;

    // Terminals
    const tPos = new Terminal(`${id}-pos`, id, 'positive', new THREE.Vector3(0.26, 0, 0));
    const tNeg = new Terminal(`${id}-neg`, id, 'negative', new THREE.Vector3(-0.25, 0, 0));
    this.terminals.push(tPos, tNeg);

    for (const t of this.terminals) {
      const color = t.polarity === 'positive' ? 0xff4444 : 0x3366ff;
      const emissive = t.polarity === 'positive' ? 0xff0000 : 0x0022aa;
      const sphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.032, 12, 12),
        new THREE.MeshStandardMaterial({
          color,
          emissive,
          emissiveIntensity: 0.3,
          metalness: 0.5,
          roughness: 0.3,
        })
      );
      sphere.position.copy(t.localPosition);
      group.add(sphere);
      t.mesh = sphere;
    }
  }

  getResistance(): number {
    return 0.05; // small internal resistance
  }
}
