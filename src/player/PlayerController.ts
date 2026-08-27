/**
 * First-person player controller.
 * WASD + mouse look + gravity + simple AABB collision + interaction raycast.
 */

import * as THREE from 'three';

export interface Interactable {
  mesh: THREE.Object3D;
  label: string;
  onInteract: () => void;
}

export class PlayerController {
  public readonly object = new THREE.Object3D(); // feet / body
  public readonly camera: THREE.PerspectiveCamera;

  private velocity = new THREE.Vector3();
  private direction = new THREE.Vector3();
  private keys: Record<string, boolean> = {};
  private isLocked = false;
  private pitch = 0;
  private yaw = 0;

  private readonly eyeHeight: number;
  private readonly moveSpeed: number;
  private readonly lookSpeed: number;
  private readonly gravity = 22;
  private readonly jumpForce = 7.5;
  private onGround = true;
  private readonly playerRadius = 0.32;
  private readonly playerHeight = 1.7;

  public colliders: THREE.Box3[] = [];
  private interactables: Interactable[] = [];
  private raycaster = new THREE.Raycaster();
  private currentTarget: Interactable | null = null;

  public onInteractPrompt: ((text: string | null) => void) | null = null;

  constructor(camera: THREE.PerspectiveCamera, opts: { eyeHeight?: number; moveSpeed?: number; lookSpeed?: number } = {}) {
    this.camera = camera;
    this.eyeHeight = opts.eyeHeight ?? 1.6;
    this.moveSpeed = opts.moveSpeed ?? 4.8;
    this.lookSpeed = opts.lookSpeed ?? 0.0022;

    this.object.position.set(0, 0, 3.5);
    this.camera.position.set(0, this.eyeHeight, 0);
    this.object.add(this.camera);

    this.bindInput();
  }

  private bindInput() {
    document.addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (e.code === 'KeyE' && this.currentTarget) {
        this.currentTarget.onInteract();
      }
    });
    document.addEventListener('keyup', (e) => {
      this.keys[e.code] = false;
    });

    // Pointer lock — bind after canvas exists
    const tryBindCanvas = () => {
      const canvas = document.querySelector('canvas');
      if (!canvas) {
        requestAnimationFrame(tryBindCanvas);
        return;
      }
      canvas.addEventListener('click', () => {
        if (!this.isLocked) canvas.requestPointerLock();
      });
    };
    tryBindCanvas();

    document.addEventListener('pointerlockchange', () => {
      this.isLocked = !!document.pointerLockElement;
    });

    document.addEventListener('mousemove', (e) => {
      if (!this.isLocked) return;
      this.yaw -= e.movementX * this.lookSpeed;
      this.pitch -= e.movementY * this.lookSpeed;
      this.pitch = Math.max(-1.4, Math.min(1.4, this.pitch));
    });
  }

  registerInteractable(mesh: THREE.Object3D, label: string, onInteract: () => void) {
    this.interactables.push({ mesh, label, onInteract });
  }

  clearInteractables() {
    if (this.currentTarget) {
      this.setHighlight(this.currentTarget.mesh, false);
    }
    this.interactables = [];
    this.currentTarget = null;
    this.onInteractPrompt?.(null);
  }

  update(dt: number) {
    // Look
    this.object.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;

    // Move
    this.direction.set(0, 0, 0);
    if (this.keys['KeyW']) this.direction.z -= 1;
    if (this.keys['KeyS']) this.direction.z += 1;
    if (this.keys['KeyA']) this.direction.x -= 1;
    if (this.keys['KeyD']) this.direction.x += 1;
    this.direction.normalize();

    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    const mx = this.direction.x * cos + this.direction.z * sin;
    const mz = -this.direction.x * sin + this.direction.z * cos;

    this.velocity.x = mx * this.moveSpeed;
    this.velocity.z = mz * this.moveSpeed;

    if (!this.onGround) {
      this.velocity.y -= this.gravity * dt;
    } else {
      this.velocity.y = 0;
    }

    if (this.keys['Space'] && this.onGround) {
      this.velocity.y = this.jumpForce;
      this.onGround = false;
    }

    const next = this.object.position.clone();
    next.x += this.velocity.x * dt;
    next.z += this.velocity.z * dt;
    next.y += this.velocity.y * dt;

    if (next.y < 0) {
      next.y = 0;
      this.velocity.y = 0;
      this.onGround = true;
    }

    // Simple AABB wall collision
    const playerBox = new THREE.Box3(
      new THREE.Vector3(next.x - this.playerRadius, next.y, next.z - this.playerRadius),
      new THREE.Vector3(next.x + this.playerRadius, next.y + this.playerHeight, next.z + this.playerRadius)
    );

    for (const col of this.colliders) {
      if (playerBox.intersectsBox(col)) {
        const overlapX = Math.min(playerBox.max.x, col.max.x) - Math.max(playerBox.min.x, col.min.x);
        const overlapZ = Math.min(playerBox.max.z, col.max.z) - Math.max(playerBox.min.z, col.min.z);
        if (overlapX < overlapZ) {
          next.x += playerBox.min.x < col.min.x ? -overlapX : overlapX;
        } else {
          next.z += playerBox.min.z < col.min.z ? -overlapZ : overlapZ;
        }
      }
    }

    // Room bounds
    next.x = THREE.MathUtils.clamp(next.x, -4.6, 4.6);
    next.z = THREE.MathUtils.clamp(next.z, -4.6, 4.6);

    this.object.position.copy(next);
    this.updateInteraction();
  }

  private updateInteraction() {
    this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
    this.raycaster.far = 2.8;

    let closest: Interactable | null = null;
    let minDist = Infinity;

    for (const item of this.interactables) {
      const hits = this.raycaster.intersectObject(item.mesh, true);
      if (hits.length > 0 && hits[0].distance < minDist) {
        minDist = hits[0].distance;
        closest = item;
      }
    }

    if (closest !== this.currentTarget) {
      if (this.currentTarget) this.setHighlight(this.currentTarget.mesh, false);
      this.currentTarget = closest;
      if (closest) {
        this.setHighlight(closest.mesh, true);
        this.onInteractPrompt?.(closest.label);
      } else {
        this.onInteractPrompt?.(null);
      }
    } else if (closest) {
      // Keep label up-to-date (mode may change)
      this.onInteractPrompt?.(closest.label);
    }
  }

  private setHighlight(obj: THREE.Object3D, on: boolean) {
    obj.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
        if (mat?.emissive) {
          if (on) {
            if (mat.userData._origEmissive === undefined) {
              mat.userData._origEmissive = mat.emissive.getHex();
              mat.userData._origIntensity = mat.emissiveIntensity;
            }
            mat.emissive.setHex(0x00aacc);
            mat.emissiveIntensity = Math.max(mat.emissiveIntensity, 0.55);
          } else {
            mat.emissive.setHex(mat.userData._origEmissive ?? 0x000000);
            mat.emissiveIntensity = mat.userData._origIntensity ?? 0;
          }
        }
      }
    });
  }

  get position() {
    return this.object.position;
  }
}
