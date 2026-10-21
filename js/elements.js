// Tabla periódica: símbolo, nombre (es), masa atómica estándar
const RAW = `H Hidrógeno 1.008|He Helio 4.0026|Li Litio 6.94|Be Berilio 9.012|B Boro 10.81|C Carbono 12.011|N Nitrógeno 14.007|O Oxígeno 15.999|F Flúor 18.998|Ne Neón 20.18|Na Sodio 22.99|Mg Magnesio 24.305|Al Aluminio 26.982|Si Silicio 28.085|P Fósforo 30.974|S Azufre 32.06|Cl Cloro 35.45|Ar Argón 39.948|K Potasio 39.098|Ca Calcio 40.078|Sc Escandio 44.956|Ti Titanio 47.867|V Vanadio 50.942|Cr Cromo 51.996|Mn Manganeso 54.938|Fe Hierro 55.845|Co Cobalto 58.933|Ni Níquel 58.693|Cu Cobre 63.546|Zn Zinc 65.38|Ga Galio 69.723|Ge Germanio 72.63|As Arsénico 74.922|Se Selenio 78.971|Br Bromo 79.904|Kr Kriptón 83.798|Rb Rubidio 85.468|Sr Estroncio 87.62|Y Itrio 88.906|Zr Circonio 91.224|Nb Niobio 92.906|Mo Molibdeno 95.95|Tc Tecnecio 98|Ru Rutenio 101.07|Rh Rodio 102.91|Pd Paladio 106.42|Ag Plata 107.87|Cd Cadmio 112.41|In Indio 114.82|Sn Estaño 118.71|Sb Antimonio 121.76|Te Telurio 127.6|I Yodo 126.9|Xe Xenón 131.29|Cs Cesio 132.91|Ba Bario 137.33|La Lantano 138.91|Ce Cerio 140.12|Pr Praseodimio 140.91|Nd Neodimio 144.24|Pm Prometio 145|Sm Samario 150.36|Eu Europio 151.96|Gd Gadolinio 157.25|Tb Terbio 158.93|Dy Disprosio 162.5|Ho Holmio 164.93|Er Erbio 167.26|Tm Tulio 168.93|Yb Iterbio 173.05|Lu Lutecio 174.97|Hf Hafnio 178.49|Ta Tantalio 180.95|W Wolframio 183.84|Re Renio 186.21|Os Osmio 190.23|Ir Iridio 192.22|Pt Platino 195.08|Au Oro 196.97|Hg Mercurio 200.59|Tl Talio 204.38|Pb Plomo 207.2|Bi Bismuto 208.98|Po Polonio 209|At Astato 210|Rn Radón 222|Fr Francio 223|Ra Radio 226|Ac Actinio 227|Th Torio 232.04|Pa Protactinio 231.04|U Uranio 238.03|Np Neptunio 237|Pu Plutonio 244|Am Americio 243|Cm Curio 247|Bk Berkelio 247|Cf Californio 251|Es Einstenio 252|Fm Fermio 257|Md Mendelevio 258|No Nobelio 259|Lr Lawrencio 266|Rf Rutherfordio 267|Db Dubnio 268|Sg Seaborgio 269|Bh Bohrio 270|Hs Hasio 277|Mt Meitnerio 278|Ds Darmstatio 281|Rg Roentgenio 282|Cn Copernicio 285|Nh Nihonio 286|Fl Flerovio 289|Mc Moscovio 290|Lv Livermorio 293|Ts Teneso 294|Og Oganesón 294`;

export const ELEMENTS = RAW.split('|').map((s, i) => {
  const [symbol, name, mass] = s.split(' ');
  return { Z: i + 1, symbol, name, mass: parseFloat(mass) };
});

const L_LETTER = 'spdfghik';
export const lLetter = (l) => L_LETTER[l];

// Excepciones conocidas a la regla de Madelung (estado fundamental)
const EXCEPTIONS = {
  24: { '4s': -1, '3d': 1 }, 29: { '4s': -1, '3d': 1 },
  41: { '5s': -1, '4d': 1 }, 42: { '5s': -1, '4d': 1 }, 44: { '5s': -1, '4d': 1 },
  45: { '5s': -1, '4d': 1 }, 46: { '5s': -2, '4d': 2 }, 47: { '5s': -1, '4d': 1 },
  57: { '4f': -1, '5d': 1 }, 58: { '4f': -1, '5d': 1 }, 64: { '4f': -1, '5d': 1 },
  78: { '6s': -1, '5d': 1 }, 79: { '6s': -1, '5d': 1 },
  89: { '5f': -1, '6d': 1 }, 90: { '5f': -2, '6d': 2 }, 91: { '5f': -1, '6d': 1 },
  92: { '5f': -1, '6d': 1 }, 93: { '5f': -1, '6d': 1 }, 96: { '5f': -1, '6d': 1 },
  103: { '6d': -1, '7p': 1 },
};

const MADELUNG = [];
for (let n = 1; n <= 8; n++) for (let l = 0; l < Math.min(n, 4); l++) MADELUNG.push({ n, l });
MADELUNG.sort((a, b) => (a.n + a.l) - (b.n + b.l) || a.n - b.n);

/** Configuración electrónica: lista de subcapas {n, l, occ} ordenada por n, l */
export function electronConfig(Z) {
  const map = new Map();
  let left = Z;
  for (const { n, l } of MADELUNG) {
    if (left <= 0) break;
    const occ = Math.min(left, 2 * (2 * l + 1));
    map.set(`${n}${lLetter(l)}`, { n, l, occ });
    left -= occ;
  }
  const ex = EXCEPTIONS[Z];
  if (ex) {
    for (const [key, d] of Object.entries(ex)) {
      const n = +key[0], l = L_LETTER.indexOf(key[1]);
      const s = map.get(key) || { n, l, occ: 0 };
      s.occ += d;
      map.set(key, s);
    }
  }
  return [...map.values()].filter((s) => s.occ > 0).sort((a, b) => a.n - b.n || a.l - b.l);
}

const NOBLE = [2, 10, 18, 36, 54, 86];

/** Configuración en notación abreviada con gas noble, en HTML */
export function configString(Z) {
  const core = [...NOBLE].reverse().find((g) => g < Z);
  const full = electronConfig(Z);
  let parts = full;
  let prefix = '';
  if (core) {
    const coreCfg = electronConfig(core);
    const coreKeys = new Set(coreCfg.map((s) => `${s.n}${s.l}:${s.occ}`));
    parts = full.filter((s) => !coreKeys.has(`${s.n}${s.l}:${s.occ}`));
    prefix = `[${ELEMENTS[core - 1].symbol}] `;
  }
  const madIdx = (s) => MADELUNG.findIndex((m) => m.n === s.n && m.l === s.l);
  parts = [...parts].sort((a, b) => madIdx(a) - madIdx(b));
  return prefix + parts.map((s) => `${s.n}${lLetter(s.l)}<sup>${s.occ}</sup>`).join(' ');
}

/** Carga nuclear efectiva por las reglas de Slater */
export function slaterZeff(Z, config, n, l) {
  const group = (nn, ll) => [nn, ll <= 1 ? 0 : ll - 1];
  const [gn, gk] = group(n, l);
  let S = 0;
  for (const s of config) {
    let count = s.occ;
    if (s.n === n && s.l === l) count -= 1;
    if (count <= 0) continue;
    const [sn, sk] = group(s.n, s.l);
    let w = 0;
    if (sn === gn && sk === gk) w = n === 1 ? 0.30 : 0.35;
    else if (l <= 1) {
      if (s.n === n - 1) w = 0.85;
      else if (s.n < n - 1) w = 1.0;
    } else if (sn < gn || (sn === gn && sk < gk)) w = 1.0;
    S += w * count;
  }
  return Math.max(1, Z - S);
}
