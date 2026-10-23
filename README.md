# ⚛ Atom Viewer

Visualizador 3D interactivo de **orbitales atómicos reales**, hecho con HTML, CSS y JavaScript ([Three.js](https://threejs.org/)).

**▶ Demo:** https://lurax99.github.io/atom-viewer/

## Qué muestra

Las nubes no son dibujos aproximados: cada punto se muestrea por Monte Carlo a partir de la densidad de probabilidad |ψ|² de la solución exacta de la ecuación de Schrödinger para un átomo hidrogenoide:

ψ<sub>nlm</sub>(r, θ, φ) = R<sub>nl</sub>(r) · Y<sub>lm</sub>(θ, φ)

- **R<sub>nl</sub>**: polinomios generalizados de Laguerre; r se obtiene invirtiendo la función de distribución acumulada radial.
- **Y<sub>lm</sub>**: armónicos esféricos (base real px, dxy, fz³… o base compleja e<sup>imφ</sup>); los ángulos se muestrean por rechazo.
- En átomos multielectrónicos se usa la **carga nuclear efectiva de Slater** y la configuración electrónica del estado fundamental (Madelung con sus excepciones: Cr, Cu, Pd, Au…), con los electrones repartidos según la **regla de Hund**.

## Moléculas

El modo **Molécula** calcula orbitales moleculares de verdad, no dibujos: cada OM es una combinación lineal de los orbitales atómicos de valencia (CLOA) de todos los átomos, obtenida con el **método de Hückel extendido** (Hoffmann).

- La base son los mismos orbitales hidrogenoides con Z<sub>ef</sub> de Slater del modo atómico; las integrales de solapamiento se calculan numéricamente en una malla 3D y se resuelve la ecuación secular HC = SCE.
- 20 moléculas con geometría experimental (H₂, HCl, N₂, O₂, CO, NaCl, H₂O, NH₃, CH₄, CO₂, C₂H₄, BF₃…) y la opción de **unir dos átomos cualesquiera** (distancia estimada con radios covalentes).
- Densidad total o cada OM por separado coloreado por el signo de ψ: enlazantes, antienlazantes, no enlazantes, σ y π, HOMO y LUMO.
- **Diagrama de niveles** con los orbitales atómicos de partida, conectores según la composición de cada OM y electrones (regla de Hund: el O₂ sale paramagnético).
- Cargas parciales de Mulliken, momento dipolar aproximado, diferencia de electronegatividad y tipo de enlace (apolar, polar, iónico).

Los electrones internos no se muestran, y las cargas y dipolos del Hückel extendido son cualitativos (tienden a exagerarse).

## Funciones

- 118 elementos con tabla periódica interactiva y buscador.
- Modo **Orbital** (elige n, l, m), modo **Átomo completo** (todas las subcapas ocupadas, activables una a una) y modo **Molécula**.
- Colores por **fase de ψ**, **fase animada** (evolución temporal e<sup>−iEt/ħ</sup>), **subcapa** o **densidad radial**.
- **Cortes** de la nube (mitad o lámina, siempre orientados hacia la cámara) para ver los nodos radiales.
- **Electrones simulados**: paseos aleatorios de Metropolis que recorren |ψ|² y dejan estela.
- Gráfica de la distribución radial P(r) = r²|R|² con nodos y radio más probable.
- Rotación libre o automática, vistas por ejes, núcleo con protones y neutrones, resplandor (bloom), capturas PNG y enlaces compartibles (el estado se guarda en la URL).

Atajos: `T` tabla periódica · `←`/`→` elemento anterior/siguiente (en modo molécula, orbital molecular anterior/siguiente) · `Espacio` rotación automática.

## Ejecutar en local

No necesita compilación. Basta con servir la carpeta:

```bash
python3 -m http.server 8000
```

y abrir http://localhost:8000.
