/**
 * Hybrid Modified Nodal Analysis
 * Wires union terminals (ideal short). Loads stamped as G. VS as extra unknowns.
 */

import { ElectricalComponent } from './ElectricalComponent';
import { Wire } from '../components/Wire';
import { Battery } from '../components/Battery';

export interface BranchReport {
  id: string;
  type: string;
  V: number;
  I: number;
  P: number;
}

export interface CircuitState {
  isClosed: boolean;
  totalResistance: number;
  totalVoltage: number;
  current: number;
  powerSource?: number;
  powerLoads?: number;
  pathComponentIds: string[];
  branches?: BranchReport[];
}

class Matrix {
  data: number[][];
  rows: number;
  cols: number;
  constructor(rows: number, cols: number) {
    this.rows = rows;
    this.cols = cols;
    this.data = Array.from({ length: rows }, () => new Array(cols).fill(0));
  }
  clone(): Matrix {
    const m = new Matrix(this.rows, this.cols);
    for (let i = 0; i < this.rows; i++) for (let j = 0; j < this.cols; j++) m.data[i][j] = this.data[i][j];
    return m;
  }
}

function solveLinearSystem(A: Matrix, b: number[]): number[] | null {
  const n = A.rows;
  if (n === 0) return [];
  const M = A.clone();
  const rhs = b.slice();
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    let maxVal = Math.abs(M.data[col][col]);
    for (let row = col + 1; row < n; row++) {
      const v = Math.abs(M.data[row][col]);
      if (v > maxVal) {
        maxVal = v;
        maxRow = row;
      }
    }
    if (maxVal < 1e-12) return null;
    if (maxRow !== col) {
      [M.data[col], M.data[maxRow]] = [M.data[maxRow], M.data[col]];
      [rhs[col], rhs[maxRow]] = [rhs[maxRow], rhs[col]];
    }
    const pivot = M.data[col][col];
    for (let row = col + 1; row < n; row++) {
      const factor = M.data[row][col] / pivot;
      for (let j = col; j < n; j++) M.data[row][j] -= factor * M.data[col][j];
      rhs[row] -= factor * rhs[col];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = rhs[i];
    for (let j = i + 1; j < n; j++) sum -= M.data[i][j] * x[j];
    if (Math.abs(M.data[i][i]) < 1e-12) return null;
    x[i] = sum / M.data[i][i];
  }
  return x;
}

interface Branch {
  component: ElectricalComponent;
  nodeA: number;
  nodeB: number;
  isVS: boolean;
  voltage?: number;
  G?: number;
}

export class CircuitSolver {
  private components = new Map<string, ElectricalComponent>();
  private wires: Wire[] = [];

  addComponent(c: ElectricalComponent) {
    this.components.set(c.id, c);
    if (c.type === 'wire') this.wires.push(c as Wire);
  }
  add(c: ElectricalComponent) {
    this.addComponent(c);
  }
  removeComponent(id: string) {
    const c = this.components.get(id);
    if (!c) return;
    if (c.type === 'wire') this.wires = this.wires.filter((w) => w.id !== id);
    this.components.delete(id);
  }

  solve(): CircuitState {
    for (const c of this.components.values()) {
      c.current = 0;
      c.voltage = 0;
      c.isPowered = false;
      (c as ElectricalComponent & { power?: number }).power = 0;
    }

    const batteries: Battery[] = [];
    for (const c of this.components.values()) {
      if (c.type === 'battery') batteries.push(c as Battery);
    }
    if (!batteries.length) return empty();

    const bat = batteries[0];
    const posT = bat.terminals.find((t) => t.polarity === 'positive');
    const negT = bat.terminals.find((t) => t.polarity === 'negative');
    if (!posT || !negT) return empty();

    const parent = new Map<string, string>();
    const find = (id: string): string => {
      if (!parent.has(id)) parent.set(id, id);
      let r = id;
      while (parent.get(r) !== r) r = parent.get(r)!;
      let cur = id;
      while (cur !== r) {
        const n = parent.get(cur)!;
        parent.set(cur, r);
        cur = n;
      }
      return r;
    };
    const union = (a: string, b: string) => {
      const ra = find(a),
        rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };

    const allTerms = [];
    for (const c of this.components.values()) {
      if (c.type === 'wire') continue;
      for (const t of c.terminals) allTerms.push(t);
    }
    for (const t of allTerms) find(t.id);
    for (const w of this.wires) {
      if (w.terminalA && w.terminalB) union(w.terminalA.id, w.terminalB.id);
    }

    const rootToNid = new Map<string, number>();
    let nid = 0;
    for (const t of allTerms) {
      const root = find(t.id);
      if (!rootToNid.has(root)) rootToNid.set(root, nid++);
    }
    const termToNode = new Map<string, number>();
    for (const t of allTerms) termToNode.set(t.id, rootToNid.get(find(t.id))!);

    const groundId = termToNode.get(negT.id);
    if (groundId === undefined) return empty();

    const branches: Branch[] = [];
    const vsList: Branch[] = [];
    for (const c of this.components.values()) {
      if (c.type === 'wire' || c.terminals.length < 2) continue;
      if (c.type === 'battery') {
        const pN = termToNode.get(c.terminals.find((t) => t.polarity === 'positive')!.id)!;
        const nN = termToNode.get(c.terminals.find((t) => t.polarity === 'negative')!.id)!;
        if (pN === nN) continue;
        const br: Branch = { component: c, nodeA: pN, nodeB: nN, isVS: true, voltage: (c as Battery).voltageValue };
        branches.push(br);
        vsList.push(br);
        continue;
      }
      const R = c.getResistance();
      if (!isFinite(R) || R <= 0) continue;
      const nA = termToNode.get(c.terminals[0].id)!;
      const nB = termToNode.get(c.terminals[1].id)!;
      if (nA === nB) continue;
      branches.push({ component: c, nodeA: nA, nodeB: nB, isVS: false, G: 1 / R });
    }

    const used = new Set<number>([groundId]);
    for (const br of branches) {
      used.add(br.nodeA);
      used.add(br.nodeB);
    }
    const nonGround = [...used].filter((id) => id !== groundId);
    const nV = nonGround.length;
    const nVS = vsList.length;
    const N = nV + nVS;
    if (N === 0 || nVS === 0) {
      return { isClosed: false, totalResistance: Infinity, totalVoltage: bat.voltageValue, current: 0, pathComponentIds: [] };
    }

    const nodeIndex = new Map<number, number>();
    nonGround.forEach((id, i) => nodeIndex.set(id, i));
    const Gmat = new Matrix(N, N);
    const bVec = new Array(N).fill(0);

    const stampG = (nA: number, nB: number, g: number) => {
      const i = nodeIndex.get(nA);
      const j = nodeIndex.get(nB);
      if (i !== undefined && j !== undefined) {
        Gmat.data[i][i] += g;
        Gmat.data[j][j] += g;
        Gmat.data[i][j] -= g;
        Gmat.data[j][i] -= g;
      } else if (i !== undefined) Gmat.data[i][i] += g;
      else if (j !== undefined) Gmat.data[j][j] += g;
    };

    for (const br of branches) if (!br.isVS && br.G !== undefined) stampG(br.nodeA, br.nodeB, br.G);

    vsList.forEach((vs, k) => {
      const vi = nV + k;
      const i = nodeIndex.get(vs.nodeA);
      const j = nodeIndex.get(vs.nodeB);
      if (i !== undefined) {
        Gmat.data[i][vi] += 1;
        Gmat.data[vi][i] += 1;
      }
      if (j !== undefined) {
        Gmat.data[j][vi] -= 1;
        Gmat.data[vi][j] -= 1;
      }
      bVec[vi] = vs.voltage ?? 0;
    });
    for (let i = 0; i < nV; i++) Gmat.data[i][i] += 1e-9;

    const x = solveLinearSystem(Gmat, bVec);
    if (!x) {
      return { isClosed: false, totalResistance: Infinity, totalVoltage: bat.voltageValue, current: 0, pathComponentIds: [] };
    }

    const nodeV = new Map<number, number>([[groundId, 0]]);
    for (const [id, idx] of nodeIndex) nodeV.set(id, x[idx]);
    const vsI = new Map<ElectricalComponent, number>();
    vsList.forEach((vs, k) => vsI.set(vs.component, x[nV + k]));

    let mainI = 0;
    const report: BranchReport[] = [];
    const activeIds: string[] = [];

    for (const br of branches) {
      const vA = nodeV.get(br.nodeA) ?? 0;
      const vB = nodeV.get(br.nodeB) ?? 0;
      const vDrop = vA - vB;
      let I = 0;
      if (br.isVS) {
        I = vsI.get(br.component) ?? 0;
        br.component.voltage = br.voltage ?? 0;
        br.component.current = Math.abs(I);
        (br.component as ElectricalComponent & { power: number }).power = Math.abs((br.voltage ?? 0) * I);
        br.component.isPowered = Math.abs(I) > 1e-4;
        if (br.component === bat) mainI = Math.abs(I);
      } else {
        I = (br.G ?? 0) * vDrop;
        br.component.voltage = Math.abs(vDrop);
        br.component.current = Math.abs(I);
        (br.component as ElectricalComponent & { power: number }).power = Math.abs(vDrop * I);
        br.component.isPowered = Math.abs(I) > 1e-4;
      }
      if (br.component.isPowered) activeIds.push(br.component.id);
      report.push({
        id: br.component.id,
        type: br.component.type,
        V: br.component.voltage,
        I: br.component.current,
        P: (br.component as ElectricalComponent & { power: number }).power,
      });
    }

    if (mainI > 1e-4) {
      for (const w of this.wires) {
        if (!w.terminalA || !w.terminalB) continue;
        w.current = mainI;
        w.isPowered = true;
      }
    }

    let loadP = 0;
    for (const c of this.components.values()) {
      if (c.type !== 'battery' && c.type !== 'wire') loadP += (c as ElectricalComponent & { power?: number }).power || 0;
    }

    return {
      isClosed: mainI > 1e-4,
      totalResistance: mainI > 1e-9 ? bat.voltageValue / mainI : Infinity,
      totalVoltage: bat.voltageValue,
      current: mainI,
      powerSource: bat.voltageValue * mainI,
      powerLoads: loadP,
      pathComponentIds: activeIds,
      branches: report,
    };
  }
}

function empty(): CircuitState {
  return { isClosed: false, totalResistance: Infinity, totalVoltage: 0, current: 0, pathComponentIds: [] };
}
