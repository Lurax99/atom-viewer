import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ELEMENTS, electronConfig, configString, slaterZeff, lLetter } from './elements.js';
import {
  sampleOrbital, density, energyEV, realSubscript, radiusQuantile, BOHR_ANGSTROM,
} from './physics.js';
import { MOLECULES, MOL_ELEMENTS, moleculeDef, buildMolecule, moDensity, sampleMO, formulaHTML } from './molecule.js';

const $ = (id) => document.getElementById(id);
const WORLD_RADIUS = 10; // radio en pantalla del 99 % de la nube más externa
const HUND_ORDER = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6];
const L_HUE = [190, 300, 42, 135, 15, 260, 330];

// ---------------------------------------------------------------- estado
const DEFAULTS = {
  mode: 'orbital', Z: 1, n: 4, l: 2, m: 0, basis: 'real', color: 0,
  count: 250000, size: 1.6, bright: 1, bloom: 0.75, clip: 0, balance: true,
  electrons: false, autoRotate: true, rotSpeed: 0.8, twinkle: true,
  nucleus: true, axes: false, stars: true, pos: '#22d3ee', neg: '#f97316',
  mol: 'HCl', mo: -1,
};
const state = { ...DEFAULTS };
loadHash();

function loadHash() {
  const p = new URLSearchParams(location.hash.slice(1));
  for (const [k, def] of Object.entries(DEFAULTS)) {
    if (!p.has(k)) continue;
    const v = p.get(k);
    state[k] = typeof def === 'number' ? Number(v) : typeof def === 'boolean' ? v === '1' : v;
  }
  if (state.mode === 'atom' && !p.has('color')) state.color = 2;
  if (state.mode === 'molecule' && !p.has('color')) state.color = state.mo < 0 ? 2 : 0;
  if (!moleculeDef(state.mol)) state.mol = DEFAULTS.mol;
  state.mo = Math.max(-1, Math.round(state.mo) || 0);
  state.Z = THREE.MathUtils.clamp(Math.round(state.Z) || 1, 1, 118);
  state.n = THREE.MathUtils.clamp(Math.round(state.n) || 1, 1, 7);
  state.l = THREE.MathUtils.clamp(Math.round(state.l) || 0, 0, state.n - 1);
  state.m = THREE.MathUtils.clamp(Math.round(state.m) || 0, -state.l, state.l);
}

let hashTimer;
function saveHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => {
    const p = new URLSearchParams();
    for (const [k, def] of Object.entries(DEFAULTS)) {
      if (state[k] === def) continue;
      p.set(k, typeof def === 'boolean' ? (state[k] ? '1' : '0') : state[k]);
    }
    history.replaceState(null, '', p.toString() ? `#${p}` : location.pathname);
  }, 250);
}

// ---------------------------------------------------------------- escena
const canvas = $('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02030a);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.05, 3000);
camera.up.set(0, 0, 1);
const ISO = new THREE.Vector3(22, -26, 14);
if (innerWidth < innerHeight) ISO.multiplyScalar(Math.pow(innerHeight / innerWidth, 0.75)); // pantallas verticales
camera.position.copy(ISO).multiplyScalar(2.2);

const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 2;
controls.maxDistance = 200;
controls.autoRotate = state.autoRotate;
controls.autoRotateSpeed = state.rotSpeed;

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), state.bloom, 0.6, 0.12);
composer.addPass(bloom);
composer.addPass(new OutputPass());

scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const keyLight = new THREE.PointLight(0xffffff, 40, 0, 2);
keyLight.position.set(3, -4, 5);
scene.add(keyLight);

const cloudGroup = new THREE.Group();
scene.add(cloudGroup);

// ---------------------------------------------------------------- shaders
const common = {
  uTime: { value: 0 },
  uSize: { value: state.size },
  uPR: { value: renderer.getPixelRatio() },
  uBright: { value: 1 },
  uMode: { value: state.color },
  uPos: { value: new THREE.Color(state.pos) },
  uNeg: { value: new THREE.Color(state.neg) },
  uClip: { value: state.clip },
  uCamDir: { value: new THREE.Vector3() },
  uSlab: { value: 0.55 },
  uTwinkle: { value: state.twinkle ? 1 : 0 },
  uReveal: { value: 0 },
};

const cloudVertex = /* glsl */`
  uniform float uTime, uSize, uPR, uBright, uMode, uClip, uSlab, uTwinkle, uReveal, uOmega, uGain;
  uniform vec3 uPos, uNeg, uOrbColor, uCamDir;
  attribute float aPhase, aRad, aRnd;
  varying vec3 vColor;
  varying float vAlpha;

  vec3 hsv2rgb(vec3 c) {
    vec3 p = abs(fract(c.xxx + vec3(0.0, 2.0 / 3.0, 1.0 / 3.0)) * 6.0 - 3.0);
    return c.z * mix(vec3(1.0), clamp(p - 1.0, 0.0, 1.0), c.y);
  }
  vec3 heat(float t) {
    vec3 a = mix(vec3(1.0, 0.96, 0.75), vec3(1.0, 0.5, 0.15), smoothstep(0.0, 0.3, t));
    vec3 b = mix(vec3(0.9, 0.2, 0.55), vec3(0.25, 0.35, 1.0), smoothstep(0.5, 1.0, t));
    return mix(a, b, smoothstep(0.25, 0.6, t));
  }

  void main() {
    float rev = smoothstep(aRnd - 0.15, aRnd, uReveal * 1.15);
    vec3 p = position * mix(0.7, 1.0, rev);
    vec4 wp = modelMatrix * vec4(p, 1.0);
    float d = dot(wp.xyz, uCamDir);
    bool hidden = rev <= 0.001 || (uClip > 0.5 && uClip < 1.5 && d > 0.0) || (uClip > 1.5 && abs(d) > uSlab);
    if (hidden) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); gl_PointSize = 0.0; return; }

    vec4 mv = viewMatrix * wp;
    gl_Position = projectionMatrix * mv;
    float tw = 1.0 + uTwinkle * 0.5 * sin(uTime * 2.7 + aRnd * 6283.0);
    gl_PointSize = uSize * uPR * (60.0 / -mv.z) * tw;

    if (uMode < 0.5) vColor = mix(uNeg, uPos, 0.5 + 0.5 * cos(aPhase));
    else if (uMode < 1.5) vColor = hsv2rgb(vec3(fract((aPhase + uOmega * uTime) / 6.2831853), 0.78, 1.0));
    else if (uMode < 2.5) vColor = uOrbColor;
    else vColor = heat(aRad);
    vAlpha = uBright * uGain * rev * (0.75 + 0.25 * tw);
  }
`;

const cloudFragment = /* glsl */`
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float d = dot(c, c) * 4.0;
    if (d > 1.0) discard;
    float a = exp(-d * 3.5) * vAlpha;
    gl_FragColor = vec4(vColor * a, 1.0);
  }
`;

function makeCloudMaterial(color, omega, gain) {
  return new THREE.ShaderMaterial({
    uniforms: { ...common, uOrbColor: { value: color }, uOmega: { value: omega }, uGain: { value: gain } },
    vertexShader: cloudVertex,
    fragmentShader: cloudFragment,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ---------------------------------------------------------------- orbitales
function hundElectrons(sub, m) {
  const k = 2 * sub.l + 1;
  const idx = HUND_ORDER.indexOf(m);
  return (idx < Math.min(sub.occ, k) ? 1 : 0) + (idx < Math.max(0, sub.occ - k) ? 1 : 0);
}

function subshellColor(n, l) {
  return new THREE.Color().setHSL(((L_HUE[l] + (n - l - 1) * 22) % 360) / 360, 0.9, 0.6);
}

function orbitalList() {
  const cfg = electronConfig(state.Z);
  const complex = state.basis === 'complex';
  const make = (n, l, m, occ) => {
    const Z = slaterZeff(state.Z, cfg, n, l);
    return {
      n, l, m, Z, complex, occ, key: `${n}${lLetter(l)}`,
      color: subshellColor(n, l), omega: 1.2 * Math.pow((Z * Z) / (n * n), 0.3),
    };
  };
  if (state.mode === 'orbital') {
    const sub = cfg.find((s) => s.n === state.n && s.l === state.l);
    return [make(state.n, state.l, state.m, sub ? hundElectrons(sub, state.m) : 0)];
  }
  const list = [];
  for (const sub of cfg) {
    for (const m of HUND_ORDER.slice(0, 2 * sub.l + 1)) {
      const e = hundElectrons(sub, m);
      if (e > 0) list.push(make(sub.n, sub.l, m, e));
    }
  }
  return list;
}

let current = { orbitals: [], objects: [], scale: 1, rMaxBohr: 1 };
const hiddenSubshells = new Set();

function disposeCloud() {
  for (const o of current.objects) {
    o.points.geometry.dispose();
    o.points.material.dispose();
    cloudGroup.remove(o.points);
  }
  current.objects = [];
}

function atomSamples() {
  const orbitals = orbitalList();
  // primero una muestra pequeña de cada orbital para conocer su tamaño
  const sizes = orbitals.map((o) => sampleOrbital(o, 1).r99);
  const rMaxBohr = Math.max(...sizes);
  // reparto de puntos: proporcional a los electrones (real) o realzando las capas externas
  const weights = orbitals.map((o, i) => Math.max(o.occ, 1) * (state.balance ? sizes[i] / rMaxBohr : 1));
  const totalW = weights.reduce((a, b) => a + b, 0);
  const samples = orbitals.map((o, i) => sampleOrbital(o, orbitals.length === 1 ? state.count
    : Math.max(3000, Math.round((state.count * weights[i]) / totalW))));
  return { orbitals, samples, rMaxBohr };
}

function build() {
  disposeCloud();
  const isMol = state.mode === 'molecule';
  const { orbitals, samples, rMaxBohr } = isMol ? moleculeSamples() : atomSamples();
  const scale = WORLD_RADIUS / rMaxBohr;
  cloudGroup.scale.setScalar(scale);
  if (isMol) buildAtomMarkers(scale);

  let total = 0;
  orbitals.forEach((o, i) => {
    const s = samples[i];
    const N = s.phase.length;
    total += N;
    const rnd = new Float32Array(N);
    for (let j = 0; j < N; j++) {
      rnd[j] = Math.random();
      const x = s.pos[j * 3], y = s.pos[j * 3 + 1], z = s.pos[j * 3 + 2];
      s.rad[j] = Math.min(1, Math.hypot(x, y, z) / rMaxBohr);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(s.pos, 3));
    g.setAttribute('aPhase', new THREE.BufferAttribute(s.phase, 1));
    g.setAttribute('aRad', new THREE.BufferAttribute(s.rad, 1));
    g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
    // capas internas muy compactas: se atenúan para que no saturen la imagen
    // nubes moleculares compactas (p. ej. aniones como F⁻) se atenúan para no saturar
    const gain = state.mode === 'atom' && state.balance ? THREE.MathUtils.clamp((s.r99 / rMaxBohr) ** 0.7, 0.08, 1)
      : isMol ? 0.55 * THREE.MathUtils.clamp((mol.r98 / mol.extent) ** 2, 0.15, 1) : 1;
    const points = new THREE.Points(g, makeCloudMaterial(o.color, o.omega, gain));
    points.frustumCulled = false;
    points.visible = !hiddenSubshells.has(o.key);
    cloudGroup.add(points);
    current.objects.push({ orbital: o, points, sample: s });
  });
  current = { ...current, orbitals, scale, rMaxBohr, total };
  updateBrightness();
  common.uReveal.value = 0;
  revealStart = performance.now();
  if (state.electrons) buildWalkers(); else clearWalkers();
  updateInfo();
  drawChart();
  buildLegend();
  if (isMol) renderMoChips();
}

function updateBrightness() {
  common.uBright.value = state.bright * 0.065 * Math.sqrt(250000 / Math.max(current.total || 1, 1));
}

let revealStart = 0;
let buildPending = false;
function rebuild() {
  if (buildPending) return;
  buildPending = true;
  $('loader').classList.add('on');
  saveHash();
  requestAnimationFrame(() => setTimeout(() => {
    build();
    buildPending = false;
    $('loader').classList.remove('on');
  }, 16));
}

// ---------------------------------------------------------------- moléculas
let mol = null;
function currentMolecule() {
  if (!mol || mol.id !== state.mol) mol = buildMolecule(state.mol);
  if (state.mo >= mol.mos.length) state.mo = -1;
  return mol;
}

function moColor(k) {
  return new THREE.Color().setHSL((0.52 + (k / mol.mos.length) * 0.8) % 1, 0.85, 0.6);
}

function moleculeSamples() {
  currentMolecule();
  const list = state.mo >= 0 ? [state.mo] : mol.mos.map((_, k) => k).filter((k) => mol.mos[k].occ > 0);
  const totalOcc = list.reduce((a, k) => a + mol.mos[k].occ, 0);
  const orbitals = list.map((k) => {
    const m = mol.mos[k];
    return {
      key: `mo${k}`, k, occ: m.occ, label: m.label, color: moColor(k),
      omega: 1.2 * Math.pow(Math.abs(m.E) / 13.6, 0.3), psi2: (x, y, z) => moDensity(mol, k, x, y, z),
    };
  });
  const samples = list.map((k) => sampleMO(mol, k, list.length === 1 ? state.count
    : Math.max(3000, Math.round((state.count * mol.mos[k].occ) / totalOcc))));
  return { orbitals, samples, rMaxBohr: mol.extent };
}

const dens = (o, x, y, z) => (o.psi2 ? o.psi2(x, y, z) : density(o, x, y, z));

// ---------------------------------------------------------------- electrones (Metropolis)
const TRAIL = 48;
const walkerGroup = new THREE.Group();
cloudGroup.add(walkerGroup);
let walkers = [];
let walkerPoints = null;

const electronMaterial = new THREE.ShaderMaterial({
  uniforms: { uPR: common.uPR },
  vertexShader: /* glsl */`
    uniform float uPR;
    attribute vec3 color;
    varying vec3 vColor;
    void main() {
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mv;
      gl_PointSize = uPR * 14.0 * (60.0 / -mv.z);
      vColor = color;
    }`,
  fragmentShader: /* glsl */`
    varying vec3 vColor;
    void main() {
      float d = length(gl_PointCoord - 0.5) * 2.0;
      if (d > 1.0) discard;
      vec3 c = mix(vec3(1.0), vColor, smoothstep(0.0, 0.45, d)) * (exp(-d * d * 6.0) * 2.2 + 0.15 * (1.0 - d));
      gl_FragColor = vec4(c, 1.0);
    }`,
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});

function clearWalkers() {
  for (const w of walkers) { w.line.geometry.dispose(); w.line.material.dispose(); }
  walkerGroup.clear();
  if (walkerPoints) walkerPoints.geometry.dispose();
  walkers = [];
  walkerPoints = null;
}

function buildWalkers() {
  clearWalkers();
  const solo = current.objects.length === 1;
  for (const obj of current.objects) {
    const o = obj.orbital;
    const n = solo ? Math.max(1, o.occ) : o.occ;
    for (let k = 0; k < n; k++) {
      const j = Math.floor(Math.random() * obj.sample.phase.length);
      const p = new THREE.Vector3().fromArray(obj.sample.pos, j * 3);
      const trail = new Float32Array(TRAIL * 3);
      for (let t = 0; t < TRAIL; t++) p.toArray(trail, t * 3);
      const colors = new Float32Array(TRAIL * 3);
      const c = o.color.clone().lerp(new THREE.Color(1, 1, 1), 0.35);
      for (let t = 0; t < TRAIL; t++) {
        const f = Math.pow(1 - t / TRAIL, 2) * 0.9;
        colors[t * 3] = c.r * f; colors[t * 3 + 1] = c.g * f; colors[t * 3 + 2] = c.b * f;
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(trail, 3));
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      }));
      line.frustumCulled = false;
      walkerGroup.add(line);
      walkers.push({
        o, obj, p, d: dens(o, p.x, p.y, p.z), line, trail,
        sigma: 0.09 * obj.sample.r99, color: c,
      });
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(walkers.length * 3), 3));
  const col = new Float32Array(walkers.length * 3);
  walkers.forEach((w, i) => w.color.toArray(col, i * 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  walkerPoints = new THREE.Points(g, electronMaterial);
  walkerPoints.frustumCulled = false;
  walkerGroup.add(walkerPoints);
  updateWalkerVisibility();
}

function gauss() {
  return Math.sqrt(-2 * Math.log(1 - Math.random())) * Math.cos(2 * Math.PI * Math.random());
}

function stepWalkers() {
  if (!walkerPoints) return;
  const pos = walkerPoints.geometry.attributes.position.array;
  walkers.forEach((w, i) => {
    if (!w.line.visible) { pos.fill(1e6, i * 3, i * 3 + 3); return; }
    for (let s = 0; s < 3; s++) {
      const x = w.p.x + gauss() * w.sigma, y = w.p.y + gauss() * w.sigma, z = w.p.z + gauss() * w.sigma;
      const d = dens(w.o, x, y, z);
      if (d >= w.d || Math.random() * w.d < d) { w.p.set(x, y, z); w.d = d; }
    }
    w.trail.copyWithin(3, 0, (TRAIL - 1) * 3);
    w.p.toArray(w.trail, 0);
    w.line.geometry.attributes.position.needsUpdate = true;
    w.p.toArray(pos, i * 3);
  });
  walkerPoints.geometry.attributes.position.needsUpdate = true;
}

function updateWalkerVisibility() {
  if (!walkerPoints) return;
  const pos = walkerPoints.geometry.attributes.position.array;
  walkers.forEach((w, i) => {
    w.line.visible = !hiddenSubshells.has(w.o.key);
    if (!w.line.visible) pos.fill(1e6, i * 3, i * 3 + 3);
  });
}

// ---------------------------------------------------------------- núcleo
const nucleusGroup = new THREE.Group();
scene.add(nucleusGroup);
const glowTexture = (() => {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.2, 'rgba(255,200,230,0.6)');
  grd.addColorStop(0.5, 'rgba(255,120,180,0.15)');
  grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
})();
const nucleonGeo = new THREE.SphereGeometry(1, 16, 12);
const protonMat = new THREE.MeshStandardMaterial({ color: 0xff4d6d, emissive: 0x801030, roughness: 0.35, metalness: 0.1 });
const neutronMat = new THREE.MeshStandardMaterial({ color: 0x9fb4ff, emissive: 0x1b2450, roughness: 0.35, metalness: 0.1 });

function clearNucleus() {
  nucleusGroup.traverse((o) => {
    if (o.isInstancedMesh) o.dispose();
    else if (o.isSprite) { if (o.material.map !== glowTexture) o.material.map.dispose(); o.material.dispose(); }
    else if (o.isLine) { o.geometry.dispose(); o.material.dispose(); }
  });
  nucleusGroup.clear();
  nucleusGroup.rotation.set(0, 0, 0);
}

function buildNucleus() {
  clearNucleus();
  if (state.mode === 'molecule') return; // los átomos se colocan en build()
  const el = ELEMENTS[state.Z - 1];
  const Zp = state.Z;
  const N = Math.max(0, Math.round(el.mass) - Zp);
  const A = Zp + N;
  const r = 0.07;
  const R = A === 1 ? 0 : r * Math.cbrt(A) * 1.05;
  const make = (count, mat) => {
    const mesh = new THREE.InstancedMesh(nucleonGeo, mat, Math.max(count, 1));
    mesh.count = count;
    return mesh;
  };
  const protons = make(Zp, protonMat), neutrons = make(N, neutronMat);
  // empaquetado aleatorio en una esfera, del centro hacia fuera
  const pts = [];
  for (let i = 0; i < A; i++) {
    const u = Math.cbrt((i + 0.5) / A) * R;
    const v = new THREE.Vector3(gauss(), gauss(), gauss()).normalize().multiplyScalar(u);
    pts.push(v);
  }
  const m = new THREE.Matrix4();
  let ip = 0, ineu = 0;
  pts.forEach((p, i) => {
    m.makeScale(r, r, r).setPosition(p);
    const isProton = ip < Zp && (ineu >= N || (i * Zp) / A >= ip);
    if (isProton) protons.setMatrixAt(ip++, m); else neutrons.setMatrixAt(ineu++, m);
  });
  nucleusGroup.add(protons, neutrons);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: glowTexture, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.8,
  }));
  glow.scale.setScalar(Math.max(R, r) * 9);
  nucleusGroup.add(glow);
  nucleusGroup.visible = state.nucleus;
}

const signed = (v, d = 2) => `${v < 0 ? '−' : '+'}${Math.abs(v).toFixed(d)}`;

function atomLabel(symbol, charge) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 128;
  const g = c.getContext('2d');
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = 'rgba(0,0,0,0.9)'; g.shadowBlur = 10;
  g.font = '700 58px Inter, sans-serif';
  g.fillStyle = '#e6e9ff';
  g.fillText(symbol, 128, 48);
  if (Math.abs(charge) >= 0.01) {
    g.font = '600 30px JetBrains Mono, monospace';
    g.fillStyle = charge > 0 ? '#93c5fd' : '#fca5a5';
    g.fillText(`δ${signed(charge)}`, 128, 100);
  }
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: false, depthWrite: false, transparent: true }));
  s.scale.set(3.6, 1.8, 1);
  s.center.set(0.5, -0.25);
  s.renderOrder = 10;
  return s;
}

function buildAtomMarkers(scale) {
  clearNucleus();
  const pos = mol.atoms.map((a) => new THREE.Vector3(...a.c).multiplyScalar(scale));
  for (const b of mol.bonds) {
    const g = new THREE.BufferGeometry().setFromPoints([pos[b.i], pos[b.j]]);
    nucleusGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, depthWrite: false })));
  }
  mol.atoms.forEach((a, i) => {
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowTexture, color: mol.params(a.el).color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
    }));
    glow.scale.setScalar(a.el === 'H' ? 0.9 : 1.3);
    glow.position.copy(pos[i]);
    const label = atomLabel(a.el, mol.charges[i]);
    label.position.copy(pos[i]);
    nucleusGroup.add(glow, label);
  });
  nucleusGroup.visible = state.nucleus;
}

// ---------------------------------------------------------------- estrellas y ejes
const stars = (() => {
  const N = 5000;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const c = new THREE.Color();
  for (let i = 0; i < N; i++) {
    const v = new THREE.Vector3(gauss(), gauss(), gauss()).normalize().multiplyScalar(500 + Math.random() * 600);
    v.toArray(pos, i * 3);
    c.setHSL(0.55 + Math.random() * 0.2, 0.5, 0.35 + Math.random() * 0.45 * Math.random());
    c.toArray(col, i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.9 }));
  scene.add(p);
  return p;
})();

const axes = (() => {
  const g = new THREE.Group();
  const L = WORLD_RADIUS * 1.35;
  const defs = [['x', 0xf87171, [1, 0, 0]], ['y', 0x4ade80, [0, 1, 0]], ['z', 0x60a5fa, [0, 0, 1]]];
  for (const [name, color, d] of defs) {
    const dir = new THREE.Vector3(...d);
    const geo = new THREE.BufferGeometry().setFromPoints([dir.clone().multiplyScalar(-L), dir.clone().multiplyScalar(L)]);
    g.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.55 })));
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const ctx = c.getContext('2d');
    ctx.font = 'italic 600 44px Inter, sans-serif';
    ctx.fillStyle = '#' + color.toString(16).padStart(6, '0');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(name, 32, 34);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, transparent: true }));
    s.position.copy(dir).multiplyScalar(L + 0.9);
    s.scale.setScalar(1.3);
    g.add(s);
  }
  scene.add(g);
  return g;
})();

// ---------------------------------------------------------------- información
function orbitalLabel(o, html = true) {
  const sub = o.l === 0 ? '' : o.complex ? `m=${o.m}` : realSubscript(o.l, o.m);
  if (!html) return `${o.n}${lLetter(o.l)}${sub ? ' ' + sub : ''}`;
  return `${o.n}${lLetter(o.l)}${sub ? `<sub>${sub}</sub>` : ''}`;
}

const fmt = (v, d = 3) => Number(v).toFixed(d);

function updateMoleculeInfo() {
  const d = mol.def;
  $('infoZ').textContent = '';
  $('infoSym').innerHTML = formulaHTML(d.f);
  $('infoMass').textContent = mol.atoms.reduce((s, a) => s + ELEMENTS.find((e) => e.symbol === a.el).mass, 0).toFixed(2);
  $('infoName').textContent = d.name;
  $('infoConfig').textContent = `Geometría ${d.geo} · ${mol.nElec} e⁻ de valencia`;
  document.title = `${d.name} · Atom Viewer`;

  const pct = (map) => [...map].filter(([, v]) => v > 0.04).sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(' · ');
  const rows = [];
  if (state.mo >= 0) {
    const m = mol.mos[state.mo];
    const tags = [];
    if (state.mo === mol.homo) tags.push('<span class="tag">HOMO</span>');
    if (state.mo === mol.lumo) tags.push('<span class="tag">LUMO</span>');
    tags.push(m.occ ? `<span class="tag">ocupado · ${m.occ} e⁻</span>` : '<span class="tag exc">vacío</span>');
    $('orbTitle').innerHTML = m.label + tags.join('');
    const byEl = new Map();
    m.byAtom.forEach((v, i) => byEl.set(mol.atoms[i].el, (byEl.get(mol.atoms[i].el) || 0) + v));
    rows.push(
      ['Energía', `${fmt(m.E, 2)} eV`],
      ['Carácter', `${m.sym ? m.sym + ' ' : ''}${m.kind}`],
      ['Solapamiento', signed(m.op, 3)],
      ['Por átomo', pct(byEl)],
      ['Orbitales atómicos', pct(m.byShell)],
    );
  } else {
    $('orbTitle').innerHTML = `Densidad total<span class="tag">${mol.nElec} e⁻</span>`;
    const pairs = new Map();
    for (const b of mol.bonds) {
      const k = [mol.atoms[b.i].el, mol.atoms[b.j].el].join('–');
      if (!pairs.has(k)) pairs.set(k, b);
    }
    const chi = Math.max(0, ...mol.bonds.map((b) => b.dchi));
    const type = chi < 0.4 ? 'covalente apolar' : chi < 1.7 ? 'covalente polar' : 'iónico';
    const qEl = new Map();
    mol.atoms.forEach((a, i) => { if (!qEl.has(a.el)) qEl.set(a.el, mol.charges[i]); });
    rows.push(['Enlaces', [...pairs].map(([k, b]) => `${k} ${fmt(b.d, 3)} Å`).join(' · ')]);
    const center = mol.atoms.findIndex((_, i) => mol.bonds.filter((b) => b.i === i || b.j === i).length >= 2);
    if (center >= 0 && !mol.isLinear) {
      const nb = mol.bonds.filter((b) => b.i === center || b.j === center).slice(0, 2).map((b) => (b.i === center ? b.j : b.i));
      const v = nb.map((i) => new THREE.Vector3(...mol.atoms[i].c).sub(new THREE.Vector3(...mol.atoms[center].c)));
      rows.push(['Ángulo de enlace', `${fmt(THREE.MathUtils.radToDeg(v[0].angleTo(v[1])), 1)}°`]);
    }
    rows.push(
      ['Δχ (Pauling)', `${fmt(chi, 2)} · ${type}`],
      ['Cargas (Mulliken)', [...qEl].map(([el, q]) => `${el} ${signed(q)}`).join(' · ')],
      ['Momento dipolar ≈', `${fmt(mol.dipole, 2)} D`],
      ['HOMO / LUMO', `${fmt(mol.mos[mol.homo].E, 1)} / ${mol.lumo >= 0 ? fmt(mol.mos[mol.lumo].E, 1) : '—'} eV`],
      ['Magnetismo', mol.unpaired ? `paramagnética (${mol.unpaired} e⁻ desapareados)` : 'diamagnética'],
    );
  }
  $('stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

function updateInfo() {
  if (state.mode === 'molecule') { updateMoleculeInfo(); return; }
  const el = ELEMENTS[state.Z - 1];
  $('infoZ').textContent = el.Z;
  $('infoSym').textContent = el.symbol;
  $('infoMass').textContent = el.mass;
  $('infoName').textContent = el.name;
  $('infoConfig').innerHTML = configString(el.Z);
  document.title = `${el.name} · Atom Viewer`;

  const rows = [];
  if (state.mode === 'orbital') {
    const { orbital: o, sample: s } = current.objects[0];
    const tag = o.occ ? `<span class="tag">ocupado · ${o.occ} e⁻</span>` : '<span class="tag exc">estado excitado</span>';
    $('orbTitle').innerHTML = orbitalLabel(o) + tag;
    let iMax = 0;
    s.table.P.forEach((v, i) => { if (v > s.table.P[iMax]) iMax = i; });
    rows.push(
      ['Números cuánticos', `n=${o.n}  l=${o.l}  m=${o.m}`],
      ['Nodos radiales', o.n - o.l - 1],
      ['Nodos angulares', o.l],
      ['Z efectiva (Slater)', fmt(o.Z, 2)],
      ['Energía ≈', `${fmt(energyEV(o.n, o.Z), 2)} eV`],
      ['Radio más probable', `${fmt(iMax * s.table.dr * BOHR_ANGSTROM)} Å`],
      ['Radio (90 %)', `${fmt(radiusQuantile(s.table, 0.9) * BOHR_ANGSTROM)} Å`],
    );
  } else {
    const cfg = electronConfig(state.Z);
    const nVal = Math.max(...cfg.map((s) => s.n));
    const outer = current.objects.filter((x) => x.orbital.n === nVal);
    const v = outer[outer.length - 1].orbital;
    $('orbTitle').innerHTML = `Átomo completo<span class="tag">${state.Z} e⁻</span>`;
    rows.push(
      ['Electrones', state.Z],
      ['Subcapas / orbitales', `${cfg.length} / ${current.objects.length}`],
      ['Capa de valencia', `n = ${nVal}`],
      ['Z efectiva valencia', fmt(v.Z, 2)],
      ['Energía valencia ≈', `${fmt(energyEV(v.n, v.Z), 2)} eV`],
      ['Radio nube (99 %)', `${fmt(current.rMaxBohr * BOHR_ANGSTROM)} Å`],
      ['Puntos', current.total.toLocaleString('es')],
    );
  }
  $('stats').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
}

// ---------------------------------------------------------------- gráfica radial
function drawChart() {
  if (state.mode === 'molecule') { drawMoleculeChart(); return; }
  const cv = $('radialChart');
  cv.height = 220;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const pad = { l: 16, r: 12, t: 12, b: 34 };
  const pw = W - pad.l - pad.r, ph = H - pad.t - pad.b;
  ctx.clearRect(0, 0, W, H);
  const xMax = current.rMaxBohr * 1.1;
  const S = 400;

  // agrupa por subcapa
  const groups = new Map();
  for (const { orbital: o, sample: s } of current.objects) {
    const g = groups.get(o.key) || { o, table: s.table, occ: 0 };
    g.occ += Math.max(o.occ, 1);
    groups.set(o.key, g);
  }
  const curves = [...groups.values()].map((g) => {
    const ys = new Float32Array(S);
    for (let i = 0; i < S; i++) {
      const r = (i / (S - 1)) * xMax;
      const f = r / g.table.dr;
      const k = Math.floor(f);
      ys[i] = k + 1 < g.table.P.length ? (g.table.P[k] * (1 - (f - k)) + g.table.P[k + 1] * (f - k)) * g.occ : 0;
    }
    return { ...g, ys };
  });
  const totalYs = new Float32Array(S);
  curves.forEach((c) => c.ys.forEach((v, i) => { totalYs[i] += v; }));
  const yMax = Math.max(...totalYs) * 1.08 || 1;
  const X = (i) => pad.l + (i / (S - 1)) * pw;
  const Y = (v) => pad.t + ph - (v / yMax) * ph;

  // ejes y marcas en Å
  ctx.strokeStyle = 'rgba(148,163,255,0.15)';
  ctx.fillStyle = 'rgba(139,147,184,0.9)';
  ctx.font = '18px JetBrains Mono, monospace';
  ctx.textAlign = 'center';
  const xMaxA = xMax * BOHR_ANGSTROM;
  const step = [0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10].find((s) => xMaxA / s <= 6) || 10;
  for (let a = 0; a <= xMaxA + 1e-9; a += step) {
    const x = pad.l + (a / xMaxA) * pw;
    ctx.beginPath(); ctx.moveTo(x, pad.t); ctx.lineTo(x, pad.t + ph); ctx.stroke();
    ctx.fillText(`${+a.toFixed(2)}`, x, H - 10);
  }
  ctx.textAlign = 'right';
  ctx.fillText('r (Å)', W - pad.r, pad.t + 14);

  const path = (ys) => {
    ctx.beginPath();
    ys.forEach((v, i) => (i ? ctx.lineTo(X(i), Y(v)) : ctx.moveTo(X(i), Y(v))));
  };
  const single = curves.length === 1;
  for (const c of curves) {
    if (hiddenSubshells.has(c.o.key)) continue;
    const col = `#${c.o.color.getHexString()}`;
    const lineCol = single ? state.pos : col;
    path(c.ys);
    ctx.lineTo(X(S - 1), Y(0)); ctx.lineTo(X(0), Y(0)); ctx.closePath();
    const grd = ctx.createLinearGradient(0, pad.t, 0, pad.t + ph);
    grd.addColorStop(0, lineCol + (single ? '66' : '33'));
    grd.addColorStop(1, lineCol + '00');
    ctx.fillStyle = grd;
    ctx.fill();
    path(c.ys);
    ctx.strokeStyle = lineCol;
    ctx.lineWidth = 3;
    ctx.shadowColor = lineCol; ctx.shadowBlur = 12;
    ctx.stroke();
    ctx.shadowBlur = 0;
  }
  if (!single) {
    path(totalYs);
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 5]);
    ctx.stroke();
    ctx.setLineDash([]);
  } else {
    // nodos radiales y máximo
    const ys = curves[0].ys;
    let iMax = 0;
    ys.forEach((v, i) => { if (v > ys[iMax]) iMax = i; });
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.setLineDash([4, 6]);
    ctx.beginPath(); ctx.moveTo(X(iMax), Y(ys[iMax])); ctx.lineTo(X(iMax), Y(0)); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = state.neg;
    for (let i = 2; i < S - 2; i++) {
      if (ys[i] < ys[i - 1] && ys[i] <= ys[i + 1] && ys[i] < yMax * 0.02) {
        ctx.beginPath(); ctx.arc(X(i), Y(0), 5, 0, Math.PI * 2); ctx.fill();
      }
    }
  }
}

// diagrama de niveles de los orbitales moleculares
const KIND_COLOR = { enlazante: '#67e8f9', antienlazante: '#f97316', 'no enlazante': '#a5b4fc' };
let moHits = [];

function drawMoleculeChart() {
  const cv = $('radialChart');
  cv.height = 500;
  const ctx = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  const pad = { l: 48, r: 6, t: 26, b: 44 };
  ctx.clearRect(0, 0, W, H);
  moHits = [];

  const left = [mol.elements[0]];
  const right = mol.elements.length > 1 ? mol.elements.slice(1) : [mol.elements[0]];
  const aos = [];
  for (const [side, els] of [[-1, left], [1, right]]) {
    for (const el of els) {
      const p = mol.params(el);
      aos.push({ side, el, key: `${el} ${p.n}s`, E: p.Hs, g: 1 });
      if (p.Hp !== null) aos.push({ side, el, key: `${el} ${p.n}p`, E: p.Hp, g: 3 });
    }
  }
  // niveles: todos los ocupados y los vacíos hasta algo por encima de los orbitales atómicos
  const topAO = Math.max(...aos.map((a) => a.E));
  const cut = Math.max(topAO + 5, mol.lumo >= 0 ? mol.mos[mol.lumo].E + 1 : -Infinity);
  const groups = [];
  mol.mos.forEach((m, k) => {
    if (m.E > cut && m.occ === 0) return;
    const g = groups[groups.length - 1];
    if (g && Math.abs(mol.mos[g[0]].E - m.E) < 0.02) g.push(k); else groups.push([k]);
  });
  const hidden = mol.mos.length - groups.flat().length;
  const Es = [...groups.flat().map((k) => mol.mos[k].E), ...aos.map((a) => a.E)];
  const eMin = Math.min(...Es) - 1.5, eMax = Math.max(...Es) + 1.5;
  const ph = H - pad.t - pad.b;
  const Y = (e) => pad.t + ((eMax - e) / (eMax - eMin)) * ph;
  const xL = pad.l + 44, xR = W - pad.r - 44, xM = (pad.l + W - pad.r) / 2 - 20;

  // eje de energía
  ctx.font = '20px JetBrains Mono, monospace';
  ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
  const step = [2, 5, 10, 20].find((s) => (eMax - eMin) / s <= 7) || 20;
  for (let e = Math.ceil(eMin / step) * step; e <= eMax; e += step) {
    ctx.strokeStyle = 'rgba(148,163,255,0.1)';
    ctx.beginPath(); ctx.moveTo(pad.l, Y(e)); ctx.lineTo(W - pad.r, Y(e)); ctx.stroke();
    ctx.fillStyle = 'rgba(139,147,184,0.9)';
    ctx.fillText(String(e), pad.l - 6, Y(e));
  }

  // conectores orbital atómico → molecular según su peso en el OM
  const aoEnd = (a) => [a.side < 0 ? xL + 34 : xR - 34, Y(a.E)];
  const groupX = (g, side) => xM + side * (g.length * 38) / 2;
  ctx.setLineDash([3, 5]); ctx.lineWidth = 1.5;
  for (const g of groups) {
    for (const a of aos) {
      const w = g.reduce((s, k) => s + (mol.mos[k].byShell.get(a.key) || 0), 0) / g.length;
      if (w < 0.12) continue;
      ctx.strokeStyle = `rgba(165,180,252,${Math.min(0.75, 0.15 + w * 0.6)})`;
      const [x0, y0] = aoEnd(a);
      ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(groupX(g, a.side), Y(mol.mos[g[0]].E)); ctx.stroke();
    }
  }
  ctx.setLineDash([]);

  // orbitales atómicos
  ctx.textBaseline = 'middle';
  for (const a of aos) {
    const x = a.side < 0 ? xL : xR, y = Y(a.E);
    ctx.strokeStyle = mol.params(a.el).color; ctx.lineWidth = 3;
    for (let i = 0; i < a.g; i++) {
      const w = 68 / a.g, x0 = x - 34 + i * w;
      ctx.beginPath(); ctx.moveTo(x0 + 2, y); ctx.lineTo(x0 + w - 2, y); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(230,233,255,0.85)';
    ctx.textAlign = 'center';
    ctx.font = '20px JetBrains Mono, monospace';
    ctx.fillText(a.key, x, y - 16);
  }

  // orbitales moleculares con sus electrones
  let lastLabelY = -1e9;
  for (const g of groups) {
    const y = Y(mol.mos[g[0]].E);
    const x0 = xM - (g.length * 38) / 2;
    g.forEach((k, i) => {
      const m = mol.mos[k];
      const sel = k === state.mo;
      const xs = x0 + i * 38 + 3, xe = xs + 32;
      ctx.strokeStyle = sel ? '#ffffff' : KIND_COLOR[m.kind];
      ctx.lineWidth = sel ? 5 : 3.5;
      ctx.shadowColor = sel ? '#67e8f9' : KIND_COLOR[m.kind]; ctx.shadowBlur = sel ? 16 : 6;
      ctx.beginPath(); ctx.moveTo(xs, y); ctx.lineTo(xe, y); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffffff'; ctx.textAlign = 'center'; ctx.font = '600 24px Inter, sans-serif';
      const arrows = m.occ === 2 ? '↑↓' : m.occ === 1 ? '↑' : '';
      if (arrows) ctx.fillText(arrows, (xs + xe) / 2, y - 12);
      moHits.push({ x0: xs, x1: xe, y, k });
    });
    if (Math.abs(y - lastLabelY) > 22) {
      const k = g[g.length - 1], m = mol.mos[k];
      const tag = g.includes(mol.homo) ? ' HOMO' : g.includes(mol.lumo) ? ' LUMO' : '';
      ctx.textAlign = 'left'; ctx.font = '20px JetBrains Mono, monospace';
      ctx.fillStyle = g.includes(state.mo) ? '#ffffff' : 'rgba(230,233,255,0.75)';
      ctx.fillText(m.label + tag, x0 + g.length * 38 + 6, y);
      lastLabelY = y;
    }
  }

  // leyenda
  ctx.font = '19px Inter, sans-serif'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  let lx = pad.l;
  for (const [kind, col] of Object.entries(KIND_COLOR)) {
    ctx.fillStyle = col; ctx.fillRect(lx, H - 18, 18, 5);
    ctx.fillStyle = 'rgba(139,147,184,0.95)';
    ctx.fillText(kind, lx + 24, H - 15);
    lx += 40 + ctx.measureText(kind).width;
  }
  if (hidden) { ctx.textAlign = 'right'; ctx.fillText(`+${hidden} más altos`, W - pad.r, pad.t - 10); }
  ctx.save();
  ctx.translate(14, pad.t + ph / 2); ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center'; ctx.fillText('E (eV)', 0, 0);
  ctx.restore();
}

function buildLegend() {
  const box = $('legend');
  box.innerHTML = '';
  if (state.mode === 'orbital' || (state.mode === 'molecule' && state.mo >= 0)) return;
  const seen = new Map();
  for (const { orbital: o } of current.objects) {
    const it = seen.get(o.key) || { o, occ: 0 };
    it.occ += o.occ;
    seen.set(o.key, it);
  }
  for (const [key, { o, occ }] of seen) {
    const b = document.createElement('button');
    b.innerHTML = `<i style="color:#${o.color.getHexString()};background:#${o.color.getHexString()}"></i>${o.label || key}<sup>${occ}</sup>`;
    b.title = state.mode === 'atom' ? 'Mostrar/ocultar subcapa' : 'Mostrar/ocultar orbital molecular';
    b.classList.toggle('off', hiddenSubshells.has(key));
    b.onclick = () => {
      if (hiddenSubshells.has(key)) hiddenSubshells.delete(key); else hiddenSubshells.add(key);
      b.classList.toggle('off', hiddenSubshells.has(key));
      for (const obj of current.objects) obj.points.visible = !hiddenSubshells.has(obj.orbital.key);
      updateWalkerVisibility();
      drawChart();
    };
    box.appendChild(b);
  }
}

// ---------------------------------------------------------------- interfaz
function seg(id, onPick) {
  const el = $(id);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    onPick(b.dataset.v);
  });
  return el;
}
function setSeg(id, v) {
  for (const b of $(id).querySelectorAll('button')) b.classList.toggle('on', b.dataset.v === String(v));
}

function renderQuantumButtons() {
  const n = $('nSeg'), l = $('lSeg'), m = $('mSeg');
  n.innerHTML = [1, 2, 3, 4, 5, 6, 7].map((v) => `<button data-v="${v}">${v}</button>`).join('');
  l.innerHTML = [0, 1, 2, 3, 4, 5, 6].map((v) => `<button data-v="${v}" ${v >= state.n ? 'disabled' : ''} title="l=${v}">${lLetter(v)}</button>`).join('');
  const ms = [];
  for (let v = -state.l; v <= state.l; v++) {
    const t = state.basis === 'real' && state.l > 0 ? realSubscript(state.l, v) : `m=${v}`;
    ms.push(`<button data-v="${v}" title="${t}">${state.basis === 'real' && state.l > 0 && state.l <= 3 ? t : v}</button>`);
  }
  m.innerHTML = ms.join('');
  setSeg('nSeg', state.n); setSeg('lSeg', state.l); setSeg('mSeg', state.m);

  const cfg = electronConfig(state.Z);
  $('occChips').innerHTML = cfg.map((s) =>
    `<button data-n="${s.n}" data-l="${s.l}" class="${s.n === state.n && s.l === state.l ? 'on' : ''}">${s.n}${lLetter(s.l)}<sup>${s.occ}</sup></button>`).join('');
}

function renderMolSelect() {
  const groups = ['Diatómicas', 'Poliatómicas'];
  const def = moleculeDef(state.mol);
  let html = def.group === 'custom' ? `<optgroup label="Personalizada"><option value="${def.id}">${def.f} · ${def.name}</option></optgroup>` : '';
  for (const g of groups) {
    html += `<optgroup label="${g}">${MOLECULES.filter((m) => m.group === g).map((m) => `<option value="${m.id}">${m.f} · ${m.name}</option>`).join('')}</optgroup>`;
  }
  $('molSelect').innerHTML = html;
  $('molSelect').value = state.mol;
  const opts = MOL_ELEMENTS.map((s) => `<option value="${s}">${s} · ${ELEMENTS.find((e) => e.symbol === s).name}</option>`).join('');
  if (!$('molA').options.length) {
    $('molA').innerHTML = opts; $('molB').innerHTML = opts;
    $('molA').value = 'H'; $('molB').value = 'Cl';
  }
  if (def.atoms.length === 2) { $('molA').value = def.atoms[0].el; $('molB').value = def.atoms[1].el; }
}

function renderMoChips() {
  const chips = [`<button data-k="-1" class="${state.mo < 0 ? 'on' : ''}">Densidad total</button>`];
  mol.mos.forEach((m, k) => {
    const cls = [k === state.mo ? 'on' : '', m.occ ? '' : 'virt'].join(' ');
    const tag = k === mol.homo ? ' HOMO' : k === mol.lumo ? ' LUMO' : '';
    chips.push(`<button data-k="${k}" class="${cls}" title="${m.kind} · ${m.occ} e⁻${tag}">${m.label}<sub>${fmt(m.E, 1)}</sub></button>`);
  });
  $('moChips').innerHTML = chips.join('');
}

function setColorMode(c) {
  state.color = c;
  common.uMode.value = c;
  $('colorMode').value = String(c);
  $('phaseColors').style.display = c === 0 ? '' : 'none';
}

function selectMO(k) {
  state.mo = k;
  setColorMode(k < 0 ? 2 : 0);
  hiddenSubshells.clear();
  rebuild();
}

function setMolecule(id) {
  const m = /^(\w+)-(\w+)$/.exec(id);
  if (m) { // si el par coincide con una molécula predefinida, se usa su geometría experimental
    const preset = MOLECULES.find((x) => x.atoms.length === 2 && [m[1], m[2]].sort().join() === x.atoms.map((a) => a.el).sort().join());
    if (preset) id = preset.id;
  }
  state.mol = id;
  state.mo = -1;
  setColorMode(2);
  hiddenSubshells.clear();
  syncUI();
  rebuild();
}

function syncUI() {
  setSeg('modeSeg', state.mode);
  const isMol = state.mode === 'molecule';
  $('elementGroup').style.display = isMol ? 'none' : '';
  $('moleculeGroup').style.display = isMol ? '' : 'none';
  $('chartCard').classList.toggle('mol', isMol);
  $('symbolBtn').classList.toggle('mol', isMol);
  $('chartTitle').innerHTML = isMol ? 'Diagrama de orbitales moleculares' : 'Distribución radial <i>P(r) = r²|R(r)|²</i>';
  if (isMol) renderMolSelect();
  setSeg('basisSeg', state.basis);
  setSeg('clipSeg', state.clip);
  $('orbitalGroup').style.display = state.mode === 'orbital' ? '' : 'none';
  $('balanceRow').style.display = state.mode === 'atom' ? '' : 'none';
  $('colorMode').value = String(state.color);
  $('phaseColors').style.display = state.color === 0 ? '' : 'none';
  renderQuantumButtons();
}

function setElement(Z) {
  state.Z = THREE.MathUtils.clamp(Z, 1, 118);
  hiddenSubshells.clear();
  if (state.mode === 'molecule') { state.mode = 'orbital'; setColorMode(0); }
  if (state.mode === 'orbital') {
    // al cambiar de elemento, muestra su orbital de valencia (el último en llenarse)
    const cfg = electronConfig(state.Z);
    const v = [...cfg].sort((a, b) => (a.n + a.l) - (b.n + b.l) || a.n - b.n).pop();
    state.n = v.n; state.l = v.l; state.m = 0;
  }
  buildNucleus();
  syncUI();
  rebuild();
}

seg('modeSeg', (v) => {
  state.mode = v;
  setColorMode(v === 'atom' || (v === 'molecule' && state.mo < 0) ? 2 : 0);
  hiddenSubshells.clear();
  buildNucleus();
  syncUI();
  rebuild();
});
seg('basisSeg', (v) => { state.basis = v; syncUI(); rebuild(); });
seg('nSeg', (v) => { state.n = +v; state.l = Math.min(state.l, state.n - 1); state.m = THREE.MathUtils.clamp(state.m, -state.l, state.l); syncUI(); rebuild(); });
seg('lSeg', (v) => { state.l = +v; state.m = THREE.MathUtils.clamp(state.m, -state.l, state.l); syncUI(); rebuild(); });
seg('mSeg', (v) => { state.m = +v; syncUI(); rebuild(); });
seg('clipSeg', (v) => { state.clip = +v; common.uClip.value = state.clip; setSeg('clipSeg', v); saveHash(); });
seg('viewSeg', (v) => flyTo(v));
$('occChips').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  state.n = +b.dataset.n; state.l = +b.dataset.l; state.m = 0;
  syncUI(); rebuild();
});

$('molSelect').addEventListener('change', (e) => setMolecule(e.target.value));
$('molJoin').addEventListener('click', () => setMolecule(`${$('molA').value}-${$('molB').value}`));
$('moChips').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (b) selectMO(+b.dataset.k);
});
$('radialChart').addEventListener('click', (e) => {
  if (state.mode !== 'molecule') return;
  const cv = e.currentTarget, r = cv.getBoundingClientRect();
  const x = ((e.clientX - r.left) * cv.width) / r.width, y = ((e.clientY - r.top) * cv.height) / r.height;
  const hit = moHits.find((h) => x >= h.x0 - 4 && x <= h.x1 + 4 && Math.abs(y - h.y) < 16);
  if (hit) selectMO(hit.k === state.mo ? -1 : hit.k);
});

$('colorMode').addEventListener('change', (e) => {
  state.color = +e.target.value;
  common.uMode.value = state.color;
  $('phaseColors').style.display = state.color === 0 ? '' : 'none';
  saveHash();
});
$('posColor').value = state.pos;
$('negColor').value = state.neg;
$('posColor').addEventListener('input', (e) => { state.pos = e.target.value; common.uPos.value.set(state.pos); drawChart(); saveHash(); });
$('negColor').addEventListener('input', (e) => { state.neg = e.target.value; common.uNeg.value.set(state.neg); drawChart(); saveHash(); });
$('paletteBtn').addEventListener('click', () => {
  const h = Math.random();
  const a = new THREE.Color().setHSL(h, 0.9, 0.58), b = new THREE.Color().setHSL((h + 0.35 + Math.random() * 0.3) % 1, 0.9, 0.58);
  state.pos = `#${a.getHexString()}`; state.neg = `#${b.getHexString()}`;
  $('posColor').value = state.pos; $('negColor').value = state.neg;
  common.uPos.value.set(state.pos); common.uNeg.value.set(state.neg);
  drawChart(); saveHash();
});

function slider(id, key, fmtFn, onInput, onChange) {
  const input = $(id), out = $(`${id === 'rotSpeed' ? 'rot' : id}Out`);
  input.value = state[key];
  const show = () => { out.textContent = fmtFn(state[key]); };
  show();
  input.addEventListener('input', () => { state[key] = +input.value; show(); onInput?.(); saveHash(); });
  if (onChange) input.addEventListener('change', onChange);
}
slider('count', 'count', (v) => (v >= 1e6 ? '1M' : `${Math.round(v / 1000)}k`), null, () => rebuild());
slider('size', 'size', (v) => v.toFixed(1), () => { common.uSize.value = state.size; });
slider('bright', 'bright', (v) => v.toFixed(2), updateBrightness);
slider('bloom', 'bloom', (v) => v.toFixed(2), () => { bloom.strength = state.bloom; });
slider('rotSpeed', 'rotSpeed', (v) => v.toFixed(1), () => { controls.autoRotateSpeed = state.rotSpeed; });

function toggle(id, key, apply) {
  const input = $(id);
  input.checked = state[key];
  apply();
  input.addEventListener('change', () => { state[key] = input.checked; apply(); saveHash(); });
}
toggle('electrons', 'electrons', () => { if (state.electrons && current.objects.length) buildWalkers(); else if (!state.electrons) clearWalkers(); });
toggle('balance', 'balance', () => { if (current.objects.length) rebuild(); });
toggle('autoRotate', 'autoRotate', () => { controls.autoRotate = state.autoRotate; });
toggle('twinkle', 'twinkle', () => { common.uTwinkle.value = state.twinkle ? 1 : 0; });
toggle('nucleus', 'nucleus', () => { nucleusGroup.visible = state.nucleus; });
toggle('axes', 'axes', () => { axes.visible = state.axes; });
toggle('stars', 'stars', () => { stars.visible = state.stars; });

$('zPrev').addEventListener('click', () => setElement(state.Z - 1));
$('zNext').addEventListener('click', () => setElement(state.Z + 1));
$('panelToggle').addEventListener('click', () => $('panel').classList.toggle('collapsed'));
$('chartToggle').addEventListener('click', () => {
  const c = $('chartCard').classList.toggle('collapsed');
  $('chartToggle').textContent = c ? '+' : '–';
});
if (innerWidth < 760) $('panel').classList.add('collapsed');

// vistas de cámara
let flight = null;
function flyTo(v) {
  const d = camera.position.length();
  const target = {
    iso: ISO.clone().setLength(d),
    x: new THREE.Vector3(d, 0, 0),
    y: new THREE.Vector3(0, -d, 0),
    z: new THREE.Vector3(0, -d * 0.001, d),
  }[v];
  flight = { from: camera.position.clone(), to: target, fromT: controls.target.clone(), t0: performance.now() };
}

// capturas, pantalla completa, enlace
function toast(msg) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove('on'), 2200);
}
$('shotBtn').addEventListener('click', () => {
  composer.render();
  const a = document.createElement('a');
  const el = ELEMENTS[state.Z - 1];
  a.download = state.mode === 'molecule'
    ? `atom-viewer-${mol.def.f}-${state.mo >= 0 ? mol.mos[state.mo].label.replace('*', '_anti').replace(/\s+/g, '_') : 'densidad'}.png`
    : `atom-viewer-${el.symbol}-${state.mode === 'orbital' ? orbitalLabel(current.objects[0].orbital, false).replace(/\s+/g, '_') : 'atomo'}.png`;
  a.href = canvas.toDataURL('image/png');
  a.click();
  toast('Captura guardada');
});
$('fsBtn').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen?.();
});
$('shareBtn').addEventListener('click', async () => {
  clearTimeout(hashTimer);
  saveHash();
  await new Promise((r) => setTimeout(r, 300));
  try { await navigator.clipboard.writeText(location.href); toast('Enlace copiado al portapapeles'); }
  catch { toast(location.href); }
});

// tabla periódica
function tablePos(Z) {
  if (Z === 1) return [1, 1];
  if (Z === 2) return [1, 18];
  if (Z <= 4) return [2, Z - 2];
  if (Z <= 10) return [2, Z + 8];
  if (Z <= 12) return [3, Z - 10];
  if (Z <= 18) return [3, Z];
  if (Z <= 36) return [4, Z - 18];
  if (Z <= 54) return [5, Z - 36];
  if (Z <= 56) return [6, Z - 54];
  if (Z <= 71) return [9, Z - 54];
  if (Z <= 86) return [6, Z - 68];
  if (Z <= 88) return [7, Z - 86];
  if (Z <= 103) return [10, Z - 86];
  return [7, Z - 100];
}
function blockOf(Z) {
  const [row, col] = tablePos(Z);
  if (row >= 9) return 'f';
  if (col <= 2 || Z === 2) return 's';
  if (col >= 13) return 'p';
  return 'd';
}
(function buildTable() {
  const box = $('ptable');
  box.innerHTML = ELEMENTS.map((e) => {
    const [r, c] = tablePos(e.Z);
    return `<button class="el ${blockOf(e.Z)}" data-z="${e.Z}" style="grid-row:${r};grid-column:${c}${r === 9 ? ';margin-top:12px' : ''}" title="${e.name}">
      <span class="n">${e.Z}</span><b>${e.symbol}</b><small>${e.name}</small></button>`;
  }).join('');
  box.addEventListener('click', (ev) => {
    const b = ev.target.closest('.el');
    if (!b) return;
    closeTable();
    setElement(+b.dataset.z);
  });
})();
function openTable() {
  for (const b of document.querySelectorAll('.el')) b.classList.toggle('cur', +b.dataset.z === state.Z);
  $('tableModal').hidden = false;
  $('elSearch').value = '';
  filterTable('');
  setTimeout(() => $('elSearch').focus(), 50);
}
function closeTable() { $('tableModal').hidden = true; }
function filterTable(q) {
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  q = norm(q.trim());
  for (const b of document.querySelectorAll('.el')) {
    const e = ELEMENTS[+b.dataset.z - 1];
    const hit = !q || norm(e.symbol) === q || norm(e.name).includes(q) || String(e.Z) === q || (q.length > 1 && norm(e.symbol).startsWith(q));
    b.classList.toggle('dim', !hit);
  }
}
$('openTable').addEventListener('click', openTable);
$('symbolBtn').addEventListener('click', () => {
  if (state.mode !== 'molecule') { openTable(); return; }
  $('panel').classList.remove('collapsed');
  $('molSelect').focus();
});
$('closeTable').addEventListener('click', closeTable);
$('tableModal').addEventListener('click', (e) => { if (e.target === $('tableModal')) closeTable(); });
$('elSearch').addEventListener('input', (e) => filterTable(e.target.value));
$('elSearch').addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { closeTable(); return; }
  if (e.key !== 'Enter') return;
  const first = [...document.querySelectorAll('.el:not(.dim)')][0];
  if (first) { closeTable(); setElement(+first.dataset.z); }
});
addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  if (e.key === 'Escape') closeTable();
  else if (e.key === 't' || e.key === 'T') openTable();
  else if (state.mode === 'molecule' && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
    const k = THREE.MathUtils.clamp(state.mo + (e.key === 'ArrowRight' ? 1 : -1), -1, mol.mos.length - 1);
    if (k !== state.mo) selectMO(k);
  } else if (e.key === 'ArrowRight') setElement(state.Z + 1);
  else if (e.key === 'ArrowLeft') setElement(state.Z - 1);
  else if (e.key === ' ') { state.autoRotate = !state.autoRotate; $('autoRotate').checked = state.autoRotate; controls.autoRotate = state.autoRotate; e.preventDefault(); }
});

addEventListener('hashchange', () => {
  loadHash();
  for (const id of ['count', 'size', 'bright', 'bloom', 'rotSpeed']) $(id).value = state[id];
  for (const id of ['balance', 'electrons', 'autoRotate', 'twinkle', 'nucleus', 'axes', 'stars']) {
    $(id).checked = state[id];
    $(id).dispatchEvent(new Event('change'));
  }
  common.uMode.value = state.color; common.uClip.value = state.clip; common.uSize.value = state.size;
  common.uPos.value.set(state.pos); common.uNeg.value.set(state.neg);
  bloom.strength = state.bloom;
  hiddenSubshells.clear();
  buildNucleus();
  syncUI();
  rebuild();
});

// ---------------------------------------------------------------- bucle
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  common.uPR.value = renderer.getPixelRatio();
});

const clock = new THREE.Clock();
const intro = { t0: performance.now(), from: camera.position.clone(), to: ISO.clone() };
controls.addEventListener('start', () => { intro.done = true; flight = null; });
const ease = (t) => 1 - Math.pow(1 - Math.min(Math.max(t, 0), 1), 3);

function animate() {
  requestAnimationFrame(animate);
  const now = performance.now();
  common.uTime.value = clock.getElapsedTime();
  common.uReveal.value = ease((now - revealStart) / 1400);

  if (!intro.done) {
    const t = (now - intro.t0) / 2600;
    if (t < 1) camera.position.lerpVectors(intro.from, intro.to, ease(t));
    else intro.done = true;
  }
  if (flight) {
    const t = ease((now - flight.t0) / 900);
    const len = THREE.MathUtils.lerp(flight.from.length(), flight.to.length(), t);
    camera.position.lerpVectors(flight.from, flight.to, t).setLength(len);
    controls.target.lerpVectors(flight.fromT, new THREE.Vector3(), t);
    if (t >= 1) flight = null;
  }

  controls.update();
  common.uCamDir.value.copy(camera.position).sub(controls.target).normalize();
  if (state.electrons) stepWalkers();
  stars.rotation.z += 0.00008;
  if (state.mode !== 'molecule') {
    nucleusGroup.rotation.z += 0.004;
    nucleusGroup.rotation.x += 0.002;
  }
  composer.render();
}

buildNucleus();
syncUI();
build();
animate();
