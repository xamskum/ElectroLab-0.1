/**
 * Electrical terminal / pin on a component.
 */

import * as THREE from 'three';

export type TerminalPolarity = 'positive' | 'negative' | 'neutral';

export class Terminal {
  public readonly id: string;
  public readonly componentId: string;
  public readonly polarity: TerminalPolarity;
  public readonly localPosition: THREE.Vector3;

  /** World-space position (updated every frame by the component) */
  public worldPosition = new THREE.Vector3();

  /** Currently connected terminal (null if free) */
  public connectedTo: Terminal | null = null;

  /** Visual sphere mesh (child of the component) */
  public mesh: THREE.Mesh | null = null;

  constructor(
    id: string,
    componentId: string,
    polarity: TerminalPolarity,
    localPos: THREE.Vector3
  ) {
    this.id = id;
    this.componentId = componentId;
    this.polarity = polarity;
    this.localPosition = localPos.clone();
  }

  /** Can this terminal accept a new wire connection? */
  isCompatible(other: Terminal): boolean {
    if (this === other) return false;
    if (this.connectedTo !== null) return false;
    if (other.connectedTo !== null) return false;
    // Same component terminals cannot be wired to each other
    if (this.componentId === other.componentId) return false;
    return true;
  }

  get isFree(): boolean {
    return this.connectedTo === null;
  }
}
