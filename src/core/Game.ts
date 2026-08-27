/**
 * Main game orchestrator
 */

import * as THREE from 'three';
import { Engine } from './Engine';
import { PlayerController } from '../player/PlayerController';
import { createLabRoom } from '../levels/LabRoom';
import { Level1 } from '../levels/Level1';

export class Game {
  private engine!: Engine;
  private player!: PlayerController;
  private level1!: Level1;

  async init() {
    const container = document.getElementById('app')!;
    this.engine = new Engine(container);

    // Lighting — bright enough to see components clearly
    const ambient = new THREE.AmbientLight(0x8aa0b8, 1.15);
    this.engine.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xfffaf5, 1.6);
    dir.position.set(4, 8, 3);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 0.5;
    dir.shadow.camera.far = 20;
    dir.shadow.camera.left = -8;
    dir.shadow.camera.right = 8;
    dir.shadow.camera.top = 8;
    dir.shadow.camera.bottom = -8;
    this.engine.scene.add(dir);

    const fill = new THREE.PointLight(0x88ddff, 1.1, 20);
    fill.position.set(-2, 2.5, -2);
    this.engine.scene.add(fill);
    const warm = new THREE.PointLight(0xffddaa, 0.85, 12);
    warm.position.set(-1.5, 2.3, -1.2);
    this.engine.scene.add(warm);
    const ceilL = new THREE.PointLight(0xeef5ff, 1.2, 16);
    ceilL.position.set(0, 3.0, 0);
    this.engine.scene.add(ceilL);
    const hemi = new THREE.HemisphereLight(0xb0c8e0, 0x3a4555, 0.55);
    this.engine.scene.add(hemi);

    // Player
    this.player = new PlayerController(this.engine.camera);
    this.engine.scene.add(this.player.object);

    // UI hooks
    const promptEl = document.getElementById('interact-prompt');
    this.player.onInteractPrompt = (text) => {
      if (!promptEl) return;
      if (text) {
        promptEl.style.display = 'block';
        promptEl.textContent = text;
      } else {
        promptEl.style.display = 'none';
      }
    };

    // Build room geometry
    const room = createLabRoom();
    this.engine.scene.add(room.group);
    this.player.colliders.push(...room.colliders);

    // Level 1 logic
    this.level1 = new Level1(this.engine.scene, this.player);
    await this.level1.setup();

    // Show UI
    const ui = document.getElementById('ui');
    if (ui) ui.style.display = 'block';

    // Update loop
    this.engine.onUpdate((dt) => {
      this.player.update(dt);
      this.level1.update(dt);
    });
  }

  start() {
    this.engine.start();
    console.log('ElectroLab started. Click canvas to lock pointer. WASD move, E interact, ESC cancel wire.');
  }
}
