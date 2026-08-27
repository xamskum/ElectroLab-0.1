/**
 * Base class for all electrical components.
 * 3D mesh only displays state — never calculates electricity itself.
 */

import * as THREE from 'three';
import { Terminal } from './Terminal';

export type ComponentType =
  | 'battery'
  | 'wire'
  | 'switch'
  | 'lamp'
  | 'door'
  | 'resistor'
  | 'led'
  | 'capacitor'
  | 'motor'
  | 'relay'
  | 'button'
  | 'sensor';

export abstract class ElectricalComponent {
  public readonly id: string;
  public readonly type: ComponentType;
  public mesh: THREE.Object3D;
  public terminals: Terminal[] = [];

  /** Runtime electrical state (written by CircuitSolver) */
  public isPowered = false;
  public current = 0;   // Amperes
  public voltage = 0;   // Volts across the component

  constructor(id: string, type: ComponentType, mesh: THREE.Object3D) {
    this.id = id;
    this.type = type;
    this.mesh = mesh;
  }

  /**
   * Resistance in Ohms.
   * Return Infinity for an open switch / broken component.
   */
  abstract getResistance(): number;

  /** Called every frame — update emissive, animation, particles etc. */
  updateVisuals(_dt: number): void {
    // override in subclasses
  }

  /** Keep terminal world positions in sync with the 3D mesh */
  updateTerminalWorldPositions() {
    this.mesh.updateMatrixWorld(true);
    for (const t of this.terminals) {
      t.worldPosition.copy(t.localPosition);
      this.mesh.localToWorld(t.worldPosition);
      // Keep the visual sphere at local position (already a child)
    }
  }
}
