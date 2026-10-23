// Moléculas: orbitales moleculares por combinación lineal de orbitales atómicos (CLOA)
// con el método de Hückel extendido (Hoffmann, 1963). Base mínima de valencia formada
// por los mismos orbitales hidrogenoides con Z efectiva de Slater que usa el visor atómico.

import { ELEMENTS, electronConfig, slaterZeff } from './elements.js';
import { radial, radialTable, radiusQuantile, BOHR_ANGSTROM } from './physics.js';

const K_EHT = 1.75;
const DEBYE = 2.541746; // e·a0 → D

// símbolo: [n de valencia, H_ss (eV), H_pp (eV), e⁻ de valencia, radio covalente (Å), χ Pauling, color]
const PARAMS = {
  H: [1, -13.6, null, 1, 0.31, 2.20, '#f1f5f9'],
  Li: [2, -5.4, -3.5, 1, 1.28, 0.98, '#c084fc'],
  Be: [2, -10.0, -6.0, 2, 0.96, 1.57, '#a3e635'],
  B: [2, -15.2, -8.5, 3, 0.84, 2.04, '#fda4af'],
  C: [2, -21.4, -11.4, 4, 0.76, 2.55, '#94a3b8'],
  N: [2, -26.0, -13.4, 5, 0.71, 3.04, '#60a5fa'],
  O: [2, -32.3, -14.8, 6, 0.66, 3.44, '#f87171'],
  F: [2, -40.0, -18.1, 7, 0.57, 3.98, '#86efac'],
  Na: [3, -5.1, -3.0, 1, 1.66, 0.93, '#a78bfa'],
  Mg: [3, -9.0, -4.5, 2, 1.41, 1.31, '#4ade80'],
  Al: [3, -12.3, -6.5, 3, 1.21, 1.61, '#cbd5e1'],
  Si: [3, -17.3, -9.2, 4, 1.11, 1.90, '#fcd34d'],
  P: [3, -18.6, -14.0, 5, 1.07, 2.19, '#fb923c'],
  S: [3, -20.0, -13.3, 6, 1.05, 2.58, '#facc15'],
  Cl: [3, -26.3, -14.2, 7, 1.02, 3.16, '#4ade80'],
  K: [4, -4.34, -2.73, 1, 2.03, 0.82, '#c084fc'],
  Br: [4, -22.07, -13.1, 7, 1.20, 2.96, '#f97316'],
  I: [5, -18.0, -12.7, 7, 1.39, 2.66, '#d946ef'],
};
export const MOL_ELEMENTS = Object.keys(PARAMS);
const bySymbol = (s) => ELEMENTS.find((e) => e.symbol === s);

// ---------------------------------------------------------------- geometrías (Å)
const deg = Math.PI / 180;
function linear(els, bonds) {
  const atoms = [{ el: els[0], p: [0, 0, 0] }];
  let z = 0;
  bonds.forEach((d, i) => { z += d; atoms.push({ el: els[i + 1], p: [0, 0, z] }); });
  return atoms;
}
function bent(c, l, d, ang) {
  const a = (ang * deg) / 2;
  return [{ el: c, p: [0, 0, 0] }, { el: l, p: [d * Math.sin(a), 0, -d * Math.cos(a)] }, { el: l, p: [-d * Math.sin(a), 0, -d * Math.cos(a)] }];
}
function pyramid(c, l, d, ang) {
  const ca = Math.sqrt((2 * Math.cos(ang * deg) + 1) / 3), sa = Math.sqrt(1 - ca * ca);
  return [{ el: c, p: [0, 0, 0] }, ...[0, 1, 2].map((i) => ({ el: l, p: [d * sa * Math.cos((2 * Math.PI * i) / 3), d * sa * Math.sin((2 * Math.PI * i) / 3), -d * ca] }))];
}
function tetra(c, l, d) {
  const k = d / Math.sqrt(3);
  return [{ el: c, p: [0, 0, 0] }, ...[[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]].map((v) => ({ el: l, p: v.map((x) => x * k) }))];
}
function trigonal(c, l, d) {
  return [{ el: c, p: [0, 0, 0] }, ...[0, 1, 2].map((i) => ({ el: l, p: [d * Math.cos((2 * Math.PI * i) / 3), d * Math.sin((2 * Math.PI * i) / 3), 0] }))];
}
function ethylene() {
  const cc = 1.339 / 2, d = 1.087, a = (117.4 / 2) * deg;
  return [
    { el: 'C', p: [-cc, 0, 0] }, { el: 'C', p: [cc, 0, 0] },
    { el: 'H', p: [cc + d * Math.cos(a), d * Math.sin(a), 0] }, { el: 'H', p: [cc + d * Math.cos(a), -d * Math.sin(a), 0] },
    { el: 'H', p: [-cc - d * Math.cos(a), d * Math.sin(a), 0] }, { el: 'H', p: [-cc - d * Math.cos(a), -d * Math.sin(a), 0] },
  ];
}

export const MOLECULES = [
  { id: 'H2', f: 'H2', name: 'Hidrógeno', group: 'Diatómicas', geo: 'lineal', atoms: linear(['H', 'H'], [0.741]) },
  { id: 'LiH', f: 'LiH', name: 'Hidruro de litio', group: 'Diatómicas', geo: 'lineal', atoms: linear(['Li', 'H'], [1.595]) },
  { id: 'HF', f: 'HF', name: 'Fluoruro de hidrógeno', group: 'Diatómicas', geo: 'lineal', atoms: linear(['H', 'F'], [0.917]) },
  { id: 'HCl', f: 'HCl', name: 'Cloruro de hidrógeno', group: 'Diatómicas', geo: 'lineal', atoms: linear(['H', 'Cl'], [1.275]) },
  { id: 'HBr', f: 'HBr', name: 'Bromuro de hidrógeno', group: 'Diatómicas', geo: 'lineal', atoms: linear(['H', 'Br'], [1.414]) },
  { id: 'N2', f: 'N2', name: 'Nitrógeno', group: 'Diatómicas', geo: 'lineal', atoms: linear(['N', 'N'], [1.098]) },
  { id: 'O2', f: 'O2', name: 'Oxígeno', group: 'Diatómicas', geo: 'lineal', atoms: linear(['O', 'O'], [1.208]) },
  { id: 'F2', f: 'F2', name: 'Flúor', group: 'Diatómicas', geo: 'lineal', atoms: linear(['F', 'F'], [1.412]) },
  { id: 'Cl2', f: 'Cl2', name: 'Cloro', group: 'Diatómicas', geo: 'lineal', atoms: linear(['Cl', 'Cl'], [1.988]) },
  { id: 'CO', f: 'CO', name: 'Monóxido de carbono', group: 'Diatómicas', geo: 'lineal', atoms: linear(['C', 'O'], [1.128]) },
  { id: 'NaCl', f: 'NaCl', name: 'Cloruro de sodio (gas)', group: 'Diatómicas', geo: 'lineal', atoms: linear(['Na', 'Cl'], [2.361]) },
  { id: 'H2O', f: 'H2O', name: 'Agua', group: 'Poliatómicas', geo: 'angular', atoms: bent('O', 'H', 0.958, 104.5) },
  { id: 'H2S', f: 'H2S', name: 'Sulfuro de hidrógeno', group: 'Poliatómicas', geo: 'angular', atoms: bent('S', 'H', 1.336, 92.1) },
  { id: 'NH3', f: 'NH3', name: 'Amoníaco', group: 'Poliatómicas', geo: 'piramidal trigonal', atoms: pyramid('N', 'H', 1.012, 106.7) },
  { id: 'CH4', f: 'CH4', name: 'Metano', group: 'Poliatómicas', geo: 'tetraédrica', atoms: tetra('C', 'H', 1.087) },
  { id: 'CO2', f: 'CO2', name: 'Dióxido de carbono', group: 'Poliatómicas', geo: 'lineal', atoms: linear(['O', 'C', 'O'], [1.160, 1.160]) },
  { id: 'HCN', f: 'HCN', name: 'Cianuro de hidrógeno', group: 'Poliatómicas', geo: 'lineal', atoms: linear(['H', 'C', 'N'], [1.064, 1.156]) },
  { id: 'C2H2', f: 'C2H2', name: 'Acetileno (etino)', group: 'Poliatómicas', geo: 'lineal', atoms: linear(['H', 'C', 'C', 'H'], [1.063, 1.203, 1.063]) },
  { id: 'C2H4', f: 'C2H4', name: 'Etileno (eteno)', group: 'Poliatómicas', geo: 'plana', atoms: ethylene() },
  { id: 'BF3', f: 'BF3', name: 'Trifluoruro de boro', group: 'Poliatómicas', geo: 'trigonal plana', atoms: trigonal('B', 'F', 1.307) },
];

/** Definición a partir de un id: molécula predefinida o par "A-B" de átomos cualesquiera */
export function moleculeDef(id) {
  const preset = MOLECULES.find((m) => m.id === id);
  if (preset) return preset;
  const m = /^([A-Z][a-z]?)-([A-Z][a-z]?)$/.exec(id || '');
  if (!m || !PARAMS[m[1]] || !PARAMS[m[2]]) return null;
  const [, a, b] = m;
  const d = PARAMS[a][4] + PARAMS[b][4];
  return {
    id, f: a === b ? `${a}2` : `${a}${b}`, name: `${bySymbol(a).name} + ${bySymbol(b).name}`,
    group: 'custom', geo: 'lineal · distancia estimada', atoms: linear([a, b], [d]),
  };
}

export const formulaHTML = (f) => f.replace(/(\d+)/g, '<sub>$1</sub>');

// ---------------------------------------------------------------- base atómica
function radialNorm(n, l, Z) {
  const t = radialTable(n, l, Z, 4000); // P = r²R²/∫r²R²: recuperamos la integral en el máximo
  let i = 1;
  t.P.forEach((v, k) => { if (v > t.P[i]) i = k; });
  const r = t.dr * i;
  const R = radial(n, l, Z, r);
  return Math.sqrt(t.P[i] / (r * r * R * R));
}

function makeBasis(atoms) {
  const basis = [];
  atoms.forEach((a, ia) => {
    const [n, hs, hp] = PARAMS[a.el];
    const el = bySymbol(a.el);
    const cfg = electronConfig(el.Z);
    const shells = [[0, hs]];
    if (hp !== null) shells.push([1, hp]);
    for (const [l, H] of shells) {
      const Z = slaterZeff(el.Z, cfg, n, l);
      const N = radialNorm(n, l, Z) / Math.sqrt(l === 0 ? 4 * Math.PI : (4 * Math.PI) / 3);
      const r99 = radiusQuantile(radialTable(n, l, Z), 0.995);
      const axes = l === 0 ? [-1] : [0, 1, 2];
      for (const axis of axes) {
        basis.push({
          atom: ia, el: a.el, n, l, axis, Z, H, N, r99, c: a.c,
          label: `${a.el} ${n}${'sp'[l]}${axis < 0 ? '' : 'xyz'[axis]}`,
        });
      }
    }
  });
  return basis;
}

function basisValue(b, x, y, z) {
  const dx = x - b.c[0], dy = y - b.c[1], dz = z - b.c[2];
  const r = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1e-9;
  const R = radial(b.n, b.l, b.Z, r) * b.N;
  if (b.l === 0) return R;
  return (R * (b.axis === 0 ? dx : b.axis === 1 ? dy : dz)) / r;
}

// ---------------------------------------------------------------- álgebra
function jacobi(A0) {
  const n = A0.length;
  const A = A0.map((r) => r.slice());
  const V = A0.map((_, i) => A0.map((__, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n; p++) for (let q = p + 1; q < n; q++) off += A[p][q] * A[p][q];
    if (off < 1e-22) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(A[p][q]) < 1e-15) continue;
        const th = (A[q][q] - A[p][p]) / (2 * A[p][q]);
        const t = (th >= 0 ? 1 : -1) / (Math.abs(th) + Math.sqrt(th * th + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const kp = A[k][p], kq = A[k][q];
          A[k][p] = c * kp - s * kq; A[k][q] = s * kp + c * kq;
        }
        for (let k = 0; k < n; k++) {
          const pk = A[p][k], qk = A[q][k];
          A[p][k] = c * pk - s * qk; A[q][k] = s * pk + c * qk;
        }
        for (let k = 0; k < n; k++) {
          const kp = V[k][p], kq = V[k][q];
          V[k][p] = c * kp - s * kq; V[k][q] = s * kp + c * kq;
        }
      }
    }
  }
  return { values: A.map((r, i) => r[i]), vectors: V };
}

const matMul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));

/** Resuelve HC = SCE por ortogonalización de Löwdin */
function generalizedEigen(H, S) {
  const { values: s, vectors: U } = jacobi(S);
  const X = U.map((r) => r.map(() => 0));
  for (let i = 0; i < s.length; i++) {
    for (let j = 0; j < s.length; j++) {
      let v = 0;
      for (let k = 0; k < s.length; k++) v += (U[i][k] * U[j][k]) / Math.sqrt(Math.max(s[k], 1e-8));
      X[i][j] = v;
    }
  }
  const { values: E, vectors: Cp } = jacobi(matMul(matMul(X, H), X));
  const C = matMul(X, Cp);
  const order = E.map((_, i) => i).sort((a, b) => E[a] - E[b]);
  return { E: order.map((i) => E[i]), C: order.map((i) => C.map((r) => r[i])) };
}

// ---------------------------------------------------------------- cálculo
const GRID_POINTS = 500000;

/** Construye la molécula: base, solapamientos numéricos, OM, ocupaciones y propiedades */
export function buildMolecule(id) {
  const def = moleculeDef(id);
  if (!def) return null;
  // centro de masas en el origen, coordenadas en bohr
  const mass = def.atoms.map((a) => bySymbol(a.el).mass);
  const M = mass.reduce((a, b) => a + b, 0);
  const cm = [0, 1, 2].map((k) => def.atoms.reduce((s, a, i) => s + a.p[k] * mass[i], 0) / M);
  const atoms = def.atoms.map((a) => ({ el: a.el, c: a.p.map((v, k) => (v - cm[k]) / BOHR_ANGSTROM) }));
  const basis = makeBasis(atoms);
  const nb = basis.length;

  // malla cartesiana que cubre todas las funciones de base
  const lo = [0, 1, 2].map((k) => Math.min(...basis.map((b) => b.c[k] - b.r99)));
  const hi = [0, 1, 2].map((k) => Math.max(...basis.map((b) => b.c[k] + b.r99)));
  const vol = (hi[0] - lo[0]) * (hi[1] - lo[1]) * (hi[2] - lo[2]);
  const h = Math.cbrt(vol / GRID_POINTS);
  const dims = [0, 1, 2].map((k) => Math.max(2, Math.ceil((hi[k] - lo[k]) / h)));
  const nPts = dims[0] * dims[1] * dims[2];
  const vals = new Float32Array(nPts * nb);
  const S = basis.map(() => new Float64Array(nb));
  const v = new Float64Array(nb);
  let p = 0;
  for (let i = 0; i < dims[0]; i++) {
    const x = lo[0] + (i + 0.5) * h;
    for (let j = 0; j < dims[1]; j++) {
      const y = lo[1] + (j + 0.5) * h;
      for (let k = 0; k < dims[2]; k++, p++) {
        const z = lo[2] + (k + 0.5) * h;
        for (let a = 0; a < nb; a++) { v[a] = basisValue(basis[a], x, y, z); vals[p * nb + a] = v[a]; }
        for (let a = 0; a < nb; a++) {
          const va = v[a];
          if (va === 0) continue;
          const Sa = S[a];
          for (let b = a; b < nb; b++) Sa[b] += va * v[b];
        }
      }
    }
  }
  // normaliza con la diagonal numérica para que los errores de malla se cancelen
  const diag = basis.map((_, a) => S[a][a]);
  const Smat = basis.map((_, a) => basis.map((__, b) => (a === b ? 1 : S[Math.min(a, b)][Math.max(a, b)] / Math.sqrt(diag[a] * diag[b]))));
  const Hmat = basis.map((ba, a) => basis.map((bb, b) => (a === b ? ba.H : (0.5 * K_EHT * (ba.H + bb.H) * Smat[a][b]))));
  const ends = [atoms[0].c, atoms[atoms.length - 1].c];
  const axisV = ends[1].map((x, k) => x - ends[0][k]);
  const axisL = Math.hypot(...axisV) || 1;
  const u = axisV.map((x) => x / axisL);
  const isLinear = atoms.length === 2 || atoms.every((a) => {
    const d = a.c.map((x, k) => x - ends[0][k]);
    const t = d[0] * u[0] + d[1] * u[1] + d[2] * u[2];
    return Math.hypot(d[0] - t * u[0], d[1] - t * u[1], d[2] - t * u[2]) < 1e-3;
  });

  // en moléculas lineales (eje z) se diagonaliza por bloques de simetría σ, πx, πy para que
  // los niveles degenerados no salgan mezclados
  let E, C, syms;
  if (isLinear && Math.abs(u[2]) > 0.999) {
    const blocks = { σ: [], πx: [], πy: [] };
    basis.forEach((b, a) => blocks[b.axis === 0 ? 'πx' : b.axis === 1 ? 'πy' : 'σ'].push(a));
    const all = [];
    for (const [name, idx] of Object.entries(blocks)) {
      if (!idx.length) continue;
      const sub = (Mx) => idx.map((a) => idx.map((b) => Mx[a][b]));
      const r = generalizedEigen(sub(Hmat), sub(Smat));
      r.E.forEach((e, k) => {
        const c = new Array(nb).fill(0);
        idx.forEach((a, t) => { c[a] = r.C[k][t]; });
        all.push({ e, c, sym: name[0] });
      });
    }
    all.sort((a, b) => a.e - b.e);
    E = all.map((x) => x.e); C = all.map((x) => x.c); syms = all.map((x) => x.sym);
  } else {
    ({ E, C } = generalizedEigen(Hmat, Smat));
    syms = E.map(() => '');
  }

  // ocupación (aufbau, con regla de Hund en niveles degenerados)
  const nElec = atoms.reduce((s, a) => s + PARAMS[a.el][3], 0);
  const occ = new Array(nb).fill(0);
  let left = nElec;
  for (let i = 0; i < nb && left > 0;) {
    let j = i;
    while (j + 1 < nb && Math.abs(E[j + 1] - E[i]) < 0.02) j++;
    const g = j - i + 1, put = Math.min(left, 2 * g);
    for (let k = 0; k < g; k++) occ[i + k] = put <= g ? (k < put ? 1 : 0) : 1 + (k < put - g ? 1 : 0);
    left -= put;
    i = j + 1;
  }

  // análisis de cada OM
  const SC = C.map((c) => basis.map((_, a) => c.reduce((s, cb, b) => s + Smat[a][b] * cb, 0)));

  const mos = C.map((c, k) => {
    let op = 0;
    for (let a = 0; a < nb; a++) for (let b = 0; b < nb; b++) if (basis[a].atom !== basis[b].atom) op += c[a] * c[b] * Smat[a][b];
    const byAtom = atoms.map(() => 0);
    const byShell = new Map();
    basis.forEach((b, a) => {
      const w = c[a] * SC[k][a];
      byAtom[b.atom] += w;
      const key = `${b.el} ${b.n}${'sp'[b.l]}`;
      byShell.set(key, (byShell.get(key) || 0) + w);
    });
    const sym = syms[k];
    const kind = op > 0.03 ? 'enlazante' : op < -0.03 ? 'antienlazante' : 'no enlazante';
    return { E: E[k], c, occ: occ[k], op, kind, sym, byAtom, byShell };
  });

  // etiquetas: 1σ, 2σ, 1π, 2σ*, … (lineales) u OM n
  const counters = {};
  let prev = null;
  mos.forEach((m, k) => {
    if (!isLinear) { m.label = `OM ${k + 1}`; return; }
    const same = prev && prev.sym === m.sym && Math.abs(prev.E - m.E) < 0.02;
    if (!same) counters[m.sym] = (counters[m.sym] || 0) + 1;
    m.label = `${counters[m.sym]}${m.sym}${m.kind === 'antienlazante' ? '*' : ''}`;
    prev = m;
  });
  const homo = mos.reduce((h, m, k) => (m.occ > 0 ? k : h), -1);
  const lumo = mos.findIndex((m, k) => k > homo && m.occ === 0) >= 0
    ? mos.findIndex((m, k) => k > homo && m.occ === 0)
    : mos.findIndex((m) => m.occ < 2);

  // cargas de Mulliken y momento dipolar
  const pop = atoms.map(() => 0);
  mos.forEach((m, k) => { if (m.occ) basis.forEach((b, a) => { pop[b.atom] += m.occ * m.c[a] * SC[k][a]; }); });
  const charges = atoms.map((a, i) => PARAMS[a.el][3] - pop[i]);
  const mu = [0, 1, 2].map((k) => atoms.reduce((s, a, i) => s + charges[i] * a.c[k], 0));

  // enlaces por distancia frente a radios covalentes
  const bonds = [];
  for (let i = 0; i < atoms.length; i++) {
    for (let j = i + 1; j < atoms.length; j++) {
      const d = Math.hypot(...atoms[i].c.map((x, k) => x - atoms[j].c[k])) * BOHR_ANGSTROM;
      const rc = PARAMS[atoms[i].el][4] + PARAMS[atoms[j].el][4];
      if (d < 1.3 * rc) bonds.push({ i, j, d, dchi: Math.abs(PARAMS[atoms[i].el][5] - PARAMS[atoms[j].el][5]) });
    }
  }

  // tamaño visual: radio que encierra el 98 % de la densidad electrónica de valencia
  const occupied = mos.filter((m) => m.occ > 0);
  const NB = 600;
  const rGrid = Math.hypot(...[0, 1, 2].map((k) => Math.max(Math.abs(lo[k]), Math.abs(lo[k] + dims[k] * h))));
  const hist = new Float64Array(NB);
  p = 0;
  for (let i = 0; i < dims[0]; i++) {
    const x = lo[0] + (i + 0.5) * h;
    for (let j = 0; j < dims[1]; j++) {
      const y = lo[1] + (j + 0.5) * h;
      for (let k = 0; k < dims[2]; k++, p++) {
        const z = lo[2] + (k + 0.5) * h;
        let rho = 0;
        for (const m of occupied) {
          let psi = 0;
          for (let a = 0; a < nb; a++) psi += m.c[a] * vals[p * nb + a];
          rho += m.occ * psi * psi;
        }
        hist[Math.min(NB - 1, Math.floor((Math.sqrt(x * x + y * y + z * z) / rGrid) * NB))] += rho;
      }
    }
  }
  const totalRho = hist.reduce((a, b) => a + b, 0);
  let accRho = 0, bin = 0;
  while (bin < NB - 1 && accRho < 0.98 * totalRho) accRho += hist[bin++];
  const r98 = (bin / NB) * rGrid;
  const extent = Math.max(r98, ...atoms.map((a) => Math.hypot(...a.c) + 1.5));
  return {
    def, id: def.id, atoms, basis, S: Smat, mos, homo, lumo, nElec, charges, bonds, isLinear, axis: u,
    dipole: Math.hypot(...mu) * DEBYE, extent, r98,
    unpaired: mos.filter((m) => m.occ === 1).length,
    grid: { lo, h, dims, nPts, vals, nb },
    elements: [...new Set(atoms.map((a) => a.el))],
    params: (el) => ({ n: PARAMS[el][0], Hs: PARAMS[el][1], Hp: PARAMS[el][2], chi: PARAMS[el][5], color: PARAMS[el][6] }),
  };
}

/** |ψ|² de un OM en un punto (bohr) */
export function moDensity(mol, k, x, y, z) {
  const c = mol.mos[k].c;
  let psi = 0;
  for (let a = 0; a < c.length; a++) if (c[a]) psi += c[a] * basisValue(mol.basis[a], x, y, z);
  return psi * psi;
}

/** Muestrea `count` puntos de |ψ_k|² sobre la malla (celda por CDF + posición uniforme dentro de ella) */
export function sampleMO(mol, k, count) {
  const { lo, h, dims, nPts, vals, nb } = mol.grid;
  const c = mol.mos[k].c;
  const cdf = new Float64Array(nPts);
  const sign = new Uint8Array(nPts);
  let acc = 0;
  for (let p = 0; p < nPts; p++) {
    let psi = 0;
    const o = p * nb;
    for (let a = 0; a < nb; a++) psi += c[a] * vals[o + a];
    acc += psi * psi;
    cdf[p] = acc;
    sign[p] = psi < 0 ? 1 : 0;
  }
  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const rad = new Float32Array(count);
  const plane = dims[1] * dims[2];
  for (let n = 0; n < count; n++) {
    const u = Math.random() * acc;
    let a = 0, b = nPts - 1;
    while (a < b) {
      const m = (a + b) >> 1;
      if (cdf[m] < u) a = m + 1; else b = m;
    }
    const i = Math.floor(a / plane), j = Math.floor((a % plane) / dims[2]), kk = a % dims[2];
    pos[n * 3] = lo[0] + (i + Math.random()) * h;
    pos[n * 3 + 1] = lo[1] + (j + Math.random()) * h;
    pos[n * 3 + 2] = lo[2] + (kk + Math.random()) * h;
    phase[n] = sign[a] ? Math.PI : 0;
  }
  return { pos, phase, rad, r99: mol.extent * 0.35 };
}
