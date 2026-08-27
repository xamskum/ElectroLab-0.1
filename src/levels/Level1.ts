/**
 * Level 1 — «Первый контакт»
 * Goal: open the door by creating a closed circuit
 * Battery → Wire → Door → Wire → Battery
 *
 * Teaching principle: experiment first, theory after.
 */

import * as THREE from 'three';
import { PlayerController } from '../player/PlayerController';
import { Battery } from '../components/Battery';
import { Wire } from '../components/Wire';
import { Door } from '../components/Door';
import { CircuitSolver } from '../electricity/CircuitSolver';
import { Terminal } from '../electricity/Terminal';
import { ElectricalComponent } from '../electricity/ElectricalComponent';

type WireMode = 'idle' | 'holding' | 'firstConnected';

export class Level1 {
  private scene: THREE.Scene;
  private player: PlayerController;
  private solver = new CircuitSolver();
  private components: ElectricalComponent[] = [];
  private wires: Wire[] = [];
  private battery!: Battery;
  private door!: Door;

  // Wiring interaction state
  private mode: WireMode = 'idle';
  private activeWire: Wire | null = null;
  private firstTerminal: Terminal | null = null;
  private tempLine: THREE.Line | null = null;
  private highlightMeshes: THREE.Mesh[] = [];

  private completed = false;
  private knowledgeShown = false;
  private messageTimer = 0;

  constructor(scene: THREE.Scene, player: PlayerController) {
    this.scene = scene;
    this.player = player;
  }

  async setup() {
    // ── Battery on table ───────────────────────────────────────────
    this.battery = new Battery('battery1', 12);
    this.battery.mesh.position.set(-1.8, 1.0, -1.5);
    this.battery.mesh.rotation.y = Math.PI / 4;
    this.scene.add(this.battery.mesh);
    this.solver.addComponent(this.battery);
    this.components.push(this.battery);

    // ── Door on north wall ─────────────────────────────────────────
    this.door = new Door('door1');
    this.door.mesh.position.set(-1.5, 0, -4.85);
    this.scene.add(this.door.mesh);
    this.solver.addComponent(this.door);
    this.components.push(this.door);

    // ── Two loose wires on the table ───────────────────────────────
    this.spawnLooseWire('wire1', new THREE.Vector3(-1.2, 0.95, -1.3));
    this.spawnLooseWire('wire2', new THREE.Vector3(-0.9, 0.95, -1.6));

    this.registerInteractables();

    // UI buttons
    document.getElementById('btn-hint')?.addEventListener('click', () => this.showHint());
    document.getElementById('btn-knowledge')?.addEventListener('click', () => {
      if (this.completed) this.showKnowledge();
      else this.showMessage('Сначала реши задачу экспериментально');
    });

    // ESC cancels wire placement
    document.addEventListener('keydown', (e) => {
      if (e.code === 'Escape' && this.mode !== 'idle') {
        this.cancelWiring();
      }
    });
  }

  // ─────────────────────────────────────────────────────────────────
  // Wire spawning & visuals
  // ─────────────────────────────────────────────────────────────────

  private spawnLooseWire(id: string, pos: THREE.Vector3) {
    const wire = new Wire(id);

    // Visual placeholder (coil of wire)
    const coil = new THREE.Group();
    const mat = new THREE.MeshStandardMaterial({
      color: 0x3a5060,
      roughness: 0.5,
      metalness: 0.4,
    });
    for (let i = 0; i < 5; i++) {
      const ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.06 + i * 0.01, 0.012, 8, 16),
        mat
      );
      ring.rotation.x = Math.PI / 2;
      ring.position.y = i * 0.008;
      coil.add(ring);
    }
    coil.name = 'placeholder';
    wire.mesh.add(coil);
    wire.mesh.position.copy(pos);
    this.scene.add(wire.mesh);

    this.solver.addComponent(wire);
    this.wires.push(wire);
    this.components.push(wire);
  }

  // ─────────────────────────────────────────────────────────────────
  // Interaction registration
  // ─────────────────────────────────────────────────────────────────

  private registerInteractables() {
    this.player.clearInteractables();

    // Battery terminals
    for (const t of this.battery.terminals) {
      if (!t.mesh) continue;
      const label =
        this.mode === 'idle'
          ? `E — контакт батареи (${t.polarity === 'positive' ? '+' : '−'})`
          : this.getTerminalPrompt(t);
      this.player.registerInteractable(t.mesh, label, () => this.onTerminalClick(t));
    }

    // Door terminals
    for (const t of this.door.terminals) {
      if (!t.mesh) continue;
      const label =
        this.mode === 'idle'
          ? 'E — контакт двери'
          : this.getTerminalPrompt(t);
      this.player.registerInteractable(t.mesh, label, () => this.onTerminalClick(t));
    }

    // Loose wires (only when idle)
    if (this.mode === 'idle') {
      for (const w of this.wires) {
        if (!w.terminalA) {
          this.player.registerInteractable(
            w.mesh,
            'E — взять провод',
            () => this.pickWire(w)
          );
        }
      }
    }
  }

  private getTerminalPrompt(t: Terminal): string {
    if (t.connectedTo) return 'E — отключить провод';
    if (this.mode === 'holding') return 'E — закрепить первый конец';
    if (this.mode === 'firstConnected') {
      if (t === this.firstTerminal) return 'Уже выбран';
      return t.isCompatible(this.firstTerminal!)
        ? 'E — соединить (зелёный)'
        : 'Занят / несовместим';
    }
    return 'E — контакт';
  }

  // ─────────────────────────────────────────────────────────────────
  // Wiring logic
  // ─────────────────────────────────────────────────────────────────

  private pickWire(wire: Wire) {
    if (this.mode !== 'idle') return;
    this.activeWire = wire;
    this.mode = 'holding';

    // Hide placeholder
    const placeholder = wire.mesh.getObjectByName('placeholder');
    if (placeholder) placeholder.visible = false;

    this.showMessage('Выберите первый контакт  ·  ESC — отмена');
    this.registerInteractables();
  }

  private onTerminalClick(terminal: Terminal) {
    // Disconnect existing connection
    if (this.mode === 'idle' && terminal.connectedTo) {
      this.disconnectFrom(terminal);
      return;
    }

    if (this.mode === 'holding') {
      // First end
      if (terminal.connectedTo) {
        this.showMessage('Контакт уже занят');
        return;
      }
      this.firstTerminal = terminal;
      this.mode = 'firstConnected';
      this.createTempLine(terminal.worldPosition);
      this.showMessage('Выберите второй контакт  ·  ESC — отмена');
      this.registerInteractables();
      this.highlightCompatible();
      return;
    }

    if (this.mode === 'firstConnected' && this.activeWire && this.firstTerminal) {
      if (terminal === this.firstTerminal) {
        this.showMessage('Нельзя соединить контакт с самим собой');
        return;
      }
      if (!this.firstTerminal.isCompatible(terminal)) {
        this.showMessage('Контакт занят или несовместим');
        return;
      }

      // Connect!
      const ok = this.activeWire.connect(this.firstTerminal, terminal);
      if (ok) {
        // Ensure wire mesh is in the scene at origin (visual is relative)
        this.activeWire.mesh.position.set(0, 0, 0);
        this.activeWire.mesh.rotation.set(0, 0, 0);
        this.scene.add(this.activeWire.mesh);

        this.playConnectSound();
        this.showMessage('Провод подключён');
        this.clearHighlights();
        this.mode = 'idle';
        this.activeWire = null;
        this.firstTerminal = null;
        this.clearTempLine();
        this.registerInteractables();
        this.solveCircuit();
      }
    }
  }

  private disconnectFrom(t: Terminal) {
    const other = t.connectedTo;
    if (!other) return;

    for (const w of this.wires) {
      if (
        (w.terminalA === t && w.terminalB === other) ||
        (w.terminalA === other && w.terminalB === t)
      ) {
        w.disconnect();
        // Restore placeholder if both ends free
        const placeholder = w.mesh.getObjectByName('placeholder');
        if (placeholder) {
          placeholder.visible = true;
          // Put back near table
          w.mesh.position.set(-1.0 + Math.random() * 0.4, 0.95, -1.4 + Math.random() * 0.3);
        }
        this.playDisconnectSound();
        this.showMessage('Провод отключён');
        this.solveCircuit();
        this.registerInteractables();
        break;
      }
    }
  }

  private cancelWiring() {
    if (this.activeWire) {
      const placeholder = this.activeWire.mesh.getObjectByName('placeholder');
      if (placeholder) placeholder.visible = true;
    }
    this.mode = 'idle';
    this.activeWire = null;
    this.firstTerminal = null;
    this.clearTempLine();
    this.clearHighlights();
    this.showMessage('Подключение отменено');
    this.registerInteractables();
  }

  // ─────────────────────────────────────────────────────────────────
  // Visual helpers (temp line + highlights)
  // ─────────────────────────────────────────────────────────────────

  private createTempLine(from: THREE.Vector3) {
    this.clearTempLine();
    const geo = new THREE.BufferGeometry().setFromPoints([
      from.clone(),
      from.clone(),
    ]);
    const mat = new THREE.LineBasicMaterial({
      color: 0x00ffaa,
      transparent: true,
      opacity: 0.85,
      linewidth: 2,
    });
    this.tempLine = new THREE.Line(geo, mat);
    this.scene.add(this.tempLine);
  }

  private clearTempLine() {
    if (this.tempLine) {
      this.scene.remove(this.tempLine);
      this.tempLine.geometry.dispose();
      (this.tempLine.material as THREE.Material).dispose();
      this.tempLine = null;
    }
  }

  private highlightCompatible() {
    this.clearHighlights();
    if (!this.firstTerminal) return;

    const allTerminals = [
      ...this.battery.terminals,
      ...this.door.terminals,
    ];

    for (const t of allTerminals) {
      if (t === this.firstTerminal || !t.mesh) continue;

      const compatible = this.firstTerminal.isCompatible(t);
      const color = compatible ? 0x00ff66 : 0xff3333;

      // Glow sphere around terminal
      const glow = new THREE.Mesh(
        new THREE.SphereGeometry(0.07, 12, 12),
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0.35,
          depthWrite: false,
        })
      );
      glow.position.copy(t.localPosition);
      t.mesh.parent?.add(glow);
      this.highlightMeshes.push(glow);
    }
  }

  private clearHighlights() {
    for (const m of this.highlightMeshes) {
      m.parent?.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.highlightMeshes = [];
  }

  // ─────────────────────────────────────────────────────────────────
  // Circuit solve + level completion
  // ─────────────────────────────────────────────────────────────────

  private solveCircuit() {
    // Update world positions of all terminals
    for (const c of this.components) {
      c.updateTerminalWorldPositions();
    }
    // Rebuild wire meshes with correct endpoints
    for (const w of this.wires) {
      if (w.terminalA && w.terminalB) {
        w.rebuildVisual();
      }
    }

    const state = this.solver.solve();
    console.log('[Circuit]', state);

    // Meter HUD
    const meter = document.getElementById('meter');
    const mi = document.getElementById('m-i');
    const mr = document.getElementById('m-r');
    const mp = document.getElementById('m-p');
    if (meter && mi && mr && mp) {
      meter.style.display = 'block';
      if (state.current > 1e-4) {
        mi.textContent = state.current.toFixed(3);
        mr.textContent = state.totalResistance.toFixed(1);
        mp.textContent = (state.powerSource ?? 0).toFixed(2);
      } else {
        mi.textContent = '0';
        mr.textContent = '∞';
        mp.textContent = '0';
      }
    }

    // Level complete only once when first closed with enough current
    if (state.isClosed && state.current > 0.05 && !this.completed) {
      this.completed = true;
      this.onLevelComplete(state);
    }
  }

  private onLevelComplete(state: { current: number; totalResistance: number }) {
    this.showMessage(`Дверь открыта!  I ≈ ${state.current.toFixed(2)} А  ·  R≈${state.totalResistance.toFixed(1)} Ω`);
    setTimeout(() => this.showKnowledge(true), 1800);
  }

  private showKnowledge(auto = false) {
    if (this.knowledgeShown && !auto) return;
    this.knowledgeShown = true;

    const existing = document.getElementById('knowledge-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'knowledge-modal';
    modal.style.cssText = `
      position: fixed; inset: 0; background: rgba(0,0,0,0.78); z-index: 300;
      display: flex; align-items: center; justify-content: center;
      pointer-events: auto; font-family: 'Segoe UI', system-ui, sans-serif;
    `;
    modal.innerHTML = `
      <div style="
        background: linear-gradient(160deg, #0c1a2b 0%, #132a42 100%);
        border: 1px solid #00d4ff55; border-radius: 14px;
        padding: 32px 36px; max-width: 520px; color: #e8f4ff;
        box-shadow: 0 0 60px #00d4ff18, 0 20px 40px #00000066;
      ">
        <div style="font-size:12px; letter-spacing:2px; color:#00d4ff99; margin-bottom:8px;">
          ЗНАНИЕ ПОЛУЧЕНО
        </div>
        <h2 style="color:#00d4ff; margin:0 0 16px; font-size:20px; font-weight:600;">
          Замкнутая электрическая цепь
        </h2>
        <p style="line-height:1.6; font-size:14.5px; margin-bottom:14px; opacity:0.95;">
          Ты создал <strong>замкнутый путь</strong>, по которому может протекать
          электрический ток. Батарея создаёт <em>разность потенциалов</em>
          (напряжение). Когда путь замкнут — заряды начинают двигаться.
        </p>
        <p style="line-height:1.55; font-size:13.5px; margin-bottom:20px; opacity:0.8;">
          Дверь получила энергию и открылась. Это и есть основа всей электроники —
          управляемый поток зарядов.
        </p>
        <div style="
          background:#00d4ff0c; border:1px solid #00d4ff33; border-radius:8px;
          padding:12px 16px; margin-bottom:22px; font-size:13px;
        ">
          <strong style="color:#00d4ff;">Попробуй:</strong> отключи любой провод —
          дверь закроется. Подключи снова — откроется.
        </div>
        <button id="close-knowledge" style="
          background:#00d4ff18; border:1px solid #00d4ff; color:#00d4ff;
          padding:11px 22px; border-radius:7px; cursor:pointer; font-size:14px;
          transition: background 0.15s;
        ">Продолжить эксперименты</button>
      </div>
    `;
    document.body.appendChild(modal);
    document.getElementById('close-knowledge')?.addEventListener('click', () => {
      modal.remove();
    });
  }

  private showHint() {
    const hints = [
      'Что необходимо, чтобы электрический ток мог течь?',
      'Проверь: есть ли непрерывный путь от одного полюса батареи к другому?',
      'Соедини оба контакта батареи с двумя контактами двери с помощью проводов.',
    ];
    const used = Number(sessionStorage.getItem('hint-l1') || '0');
    const idx = Math.min(used, hints.length - 1);
    this.showMessage(`Подсказка ${idx + 1}/${hints.length}: ${hints[idx]}`);
    sessionStorage.setItem('hint-l1', String(used + 1));
  }

  private showMessage(text: string) {
    const el = document.getElementById('task-text');
    if (!el) return;
    el.textContent = text;
    this.messageTimer = 4.5;
  }

  // ─────────────────────────────────────────────────────────────────
  // Audio (simple Web Audio beeps)
  // ─────────────────────────────────────────────────────────────────

  private playConnectSound() {
    this.beep(720, 0.12, 0.07);
    setTimeout(() => this.beep(980, 0.1, 0.05), 80);
  }

  private playDisconnectSound() {
    this.beep(400, 0.1, 0.06);
  }

  private beep(freq: number, duration: number, volume: number) {
    try {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.frequency.value = freq;
      osc.type = 'sine';
      gain.gain.setValueAtTime(volume, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch { /* audio may be blocked */ }
  }

  // ─────────────────────────────────────────────────────────────────
  // Per-frame update
  // ─────────────────────────────────────────────────────────────────

  update(dt: number) {
    // Update all component visuals & terminal world positions
    for (const c of this.components) {
      c.updateTerminalWorldPositions();
      c.updateVisuals(dt);
    }

    // Wire particle animation
    for (const w of this.wires) {
      w.updateVisuals(dt);
    }

    // Temporary wire follows the crosshair
    if (this.tempLine && this.firstTerminal) {
      const from = this.firstTerminal.worldPosition;
      const cam = this.player.camera;
      const aim = new THREE.Vector3(0, 0, -2.5)
        .applyQuaternion(cam.getWorldQuaternion(new THREE.Quaternion()))
        .add(cam.getWorldPosition(new THREE.Vector3()));

      const pos = this.tempLine.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, from.x, from.y, from.z);
      pos.setXYZ(1, aim.x, aim.y, aim.z);
      pos.needsUpdate = true;
    }

    // Message auto-reset
    if (this.messageTimer > 0) {
      this.messageTimer -= dt;
      if (this.messageTimer <= 0 && !this.completed) {
        const el = document.getElementById('task-text');
        if (el) el.textContent = 'Найди способ открыть дверь';
      }
    }
  }
}
