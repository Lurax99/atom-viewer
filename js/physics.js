// Funciones de onda hidrogenoides: ψ(r,θ,φ) = R_nl(r) · Y_lm(θ,φ)
// Unidades atómicas (radio de Bohr a0). Z puede ser una carga efectiva.

export const BOHR_ANGSTROM = 0.529177;
export const HARTREE_EV = 27.211386;

/** Polinomio generalizado de Laguerre L_k^α(x) */
export function laguerre(k, alpha, x) {
  if (k === 0) return 1;
  let L0 = 1, L1 = 1 + alpha - x;
  for (let i = 1; i < k; i++) {
    const L2 = ((2 * i + 1 + alpha - x) * L1 - (i + alpha) * L0) / (i + 1);
    L0 = L1; L1 = L2;
  }
  return L1;
}

/** Parte radial sin normalizar (la normalización no afecta al muestreo) */
export function radial(n, l, Z, r) {
  const rho = (2 * Z * r) / n;
  return Math.pow(rho, l) * Math.exp(-rho / 2) * laguerre(n - l - 1, 2 * l + 1, rho);
}

/** Polinomio asociado de Legendre P_l^m(x), m ≥ 0, sin fase de Condon–Shortley */
export function legendre(l, m, x) {
  let pmm = 1;
  if (m > 0) {
    const s = Math.sqrt(Math.max(0, 1 - x * x));
    let f = 1;
    for (let i = 1; i <= m; i++) { pmm *= f * s; f += 2; }
  }
  if (l === m) return pmm;
  let pmm1 = x * (2 * m + 1) * pmm;
  if (l === m + 1) return pmm1;
  let pll = 0;
  for (let ll = m + 2; ll <= l; ll++) {
    pll = ((2 * ll - 1) * x * pmm1 - (ll + m - 1) * pmm) / (ll - m);
    pmm = pmm1; pmm1 = pll;
  }
  return pll;
}

/**
 * Parte angular. Devuelve {amp, phase}:
 *  - base real: amp = Y real (con signo), phase = 0 ó π
 *  - base compleja: amp = |P_l^m|, phase = mφ (+π si P<0)
 */
export function angular(l, m, cosT, phi, complex) {
  const am = Math.abs(m);
  const P = legendre(l, am, cosT);
  if (complex) {
    return { amp: Math.abs(P), phase: m * phi + (P < 0 ? Math.PI : 0) };
  }
  let y = P;
  if (m > 0) y *= Math.cos(m * phi);
  else if (m < 0) y *= Math.sin(am * phi);
  return { amp: y, phase: y < 0 ? Math.PI : 0 };
}

/** |ψ|² en coordenadas cartesianas (para el paseo de Metropolis) */
export function density(o, x, y, z) {
  const r = Math.hypot(x, y, z) || 1e-9;
  const R = radial(o.n, o.l, o.Z, r);
  const A = angular(o.l, o.m, z / r, Math.atan2(y, x), o.complex).amp;
  const v = R * A;
  return v * v;
}

/** Radio razonable que contiene prácticamente toda la probabilidad */
export function rMax(n, Z) {
  return (2.6 * n * n + 9 * n) / Z;
}

/** Tabla de la distribución radial P(r) = r²R² y su función acumulada */
export function radialTable(n, l, Z, N = 3000) {
  const rmax = rMax(n, Z);
  const dr = rmax / (N - 1);
  const P = new Float64Array(N);
  const cdf = new Float64Array(N);
  let acc = 0;
  for (let i = 0; i < N; i++) {
    const r = i * dr;
    const R = radial(n, l, Z, r);
    P[i] = r * r * R * R;
    if (i > 0) acc += 0.5 * (P[i] + P[i - 1]) * dr;
    cdf[i] = acc;
  }
  for (let i = 0; i < N; i++) { cdf[i] /= acc; P[i] /= acc; }
  return { P, cdf, dr, rmax };
}

function invertCdf(t, u) {
  const { cdf, dr } = t;
  let lo = 0, hi = cdf.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < u) lo = mid; else hi = mid;
  }
  const span = cdf[hi] - cdf[lo] || 1;
  return (lo + (u - cdf[lo]) / span) * dr;
}

/** Radio que contiene la fracción q de la probabilidad */
export function radiusQuantile(t, q) { return invertCdf(t, q); }

/**
 * Muestrea `count` puntos de |ψ_nlm|² de forma exacta:
 * como ψ es separable, r se obtiene invirtiendo la CDF radial
 * y (θ,φ) por rechazo frente a |Y|².
 */
export function sampleOrbital(o, count) {
  const { n, l, m, Z, complex } = o;
  const table = radialTable(n, l, Z);
  // máximo de |Y|² para el rechazo
  let maxA = 0;
  for (let i = 0; i <= 120; i++) {
    const c = -1 + (2 * i) / 120;
    for (let j = 0; j < 64; j++) {
      const a = angular(l, m, c, (j / 64) * 2 * Math.PI, complex).amp;
      maxA = Math.max(maxA, a * a);
    }
  }
  maxA *= 1.05;

  const pos = new Float32Array(count * 3);
  const phase = new Float32Array(count);
  const rad = new Float32Array(count);
  const r99 = invertCdf(table, 0.99);
  for (let i = 0; i < count; i++) {
    let c, phi, ang;
    do {
      c = 2 * Math.random() - 1;
      phi = 2 * Math.PI * Math.random();
      ang = angular(l, m, c, phi, complex);
    } while (ang.amp * ang.amp < Math.random() * maxA);
    const r = invertCdf(table, Math.random());
    const s = Math.sqrt(1 - c * c);
    pos[i * 3] = r * s * Math.cos(phi);
    pos[i * 3 + 1] = r * s * Math.sin(phi);
    pos[i * 3 + 2] = r * c;
    const Rv = radial(n, l, Z, r);
    phase[i] = ang.phase + (Rv < 0 ? Math.PI : 0);
    rad[i] = Math.min(1, r / r99);
  }
  return { pos, phase, rad, table, r99 };
}

/** Energía hidrogenoide aproximada en eV */
export function energyEV(n, Z) {
  return (-0.5 * HARTREE_EV * Z * Z) / (n * n);
}

const REAL_NAMES = {
  1: { 0: 'z', 1: 'x', '-1': 'y' },
  2: { 0: 'z²', 1: 'xz', '-1': 'yz', 2: 'x²−y²', '-2': 'xy' },
  3: { 0: 'z³', 1: 'xz²', '-1': 'yz²', 2: 'z(x²−y²)', '-2': 'xyz', 3: 'x(x²−3y²)', '-3': 'y(3x²−y²)' },
};

/** Subíndice descriptivo del orbital real (px, dxy, …) */
export function realSubscript(l, m) {
  return (REAL_NAMES[l] && REAL_NAMES[l][m]) || `m=${m}`;
}
