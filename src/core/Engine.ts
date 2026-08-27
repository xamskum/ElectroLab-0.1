/**
 * Core rendering & loop engine using Three.js
 */

import * as THREE from 'three';

export class Engine {
  public readonly renderer: THREE.WebGLRenderer;
  public readonly scene: THREE.Scene;
  public readonly camera: THREE.PerspectiveCamera;
  public readonly clock = new THREE.Clock();

  private animationId = 0;
  private updateCallbacks: Array<(dt: number) => void> = [];
  private renderCallbacks: Array<() => void> = [];

  constructor(container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.55;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a2538);
    this.scene.fog = new THREE.Fog(0x1a2538, 18, 40);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      100
    );
    this.camera.position.set(0, 1.6, 5);

    window.addEventListener('resize', this.onResize);
  }

  private onResize = () => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  onUpdate(cb: (dt: number) => void) {
    this.updateCallbacks.push(cb);
  }

  onRender(cb: () => void) {
    this.renderCallbacks.push(cb);
  }

  start() {
    const loop = () => {
      this.animationId = requestAnimationFrame(loop);
      const dt = Math.min(this.clock.getDelta(), 0.05);
      for (const cb of this.updateCallbacks) cb(dt);
      for (const cb of this.renderCallbacks) cb();
      this.renderer.render(this.scene, this.camera);
    };
    loop();
  }

  stop() {
    cancelAnimationFrame(this.animationId);
  }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this.onResize);
    this.renderer.dispose();
  }
}
