# ⚛ Atom Viewer

Visualizador 3D interactivo de **orbitales atómicos reales**, hecho con HTML, CSS y JavaScript ([Three.js](https://threejs.org/)).

**▶ Demo:** https://lurax99.github.io/atom-viewer/

## Qué muestra

Las nubes no son dibujos aproximados: cada punto se muestrea por Monte Carlo a partir de la densidad de probabilidad |ψ|² de la solución exacta de la ecuación de Schrödinger para un átomo hidrogenoide:

ψ<sub>nlm</sub>(r, θ, φ) = R<sub>nl</sub>(r) · Y<sub>lm</sub>(θ, φ)

- **R<sub>nl</sub>**: polinomios generalizados de Laguerre; r se obtiene invirtiendo la función de distribución acumulada radial.
- **Y<sub>lm</sub>**: armónicos esféricos (base real px, dxy, fz³… o base compleja e<sup>imφ</sup>); los ángulos se muestrean por rechazo.
- En átomos multielectrónicos se usa la **carga nuclear efectiva de Slater** y la configuración electrónica del estado fundamental (Madelung con sus excepciones: Cr, Cu, Pd, Au…), con los electrones repartidos según la **regla de Hund**.

## Funciones

- 118 elementos con tabla periódica interactiva y buscador.
- Modo **Orbital** (elige n, l, m) y modo **Átomo completo** (todas las subcapas ocupadas, activables una a una).
- Colores por **fase de ψ**, **fase animada** (evolución temporal e<sup>−iEt/ħ</sup>), **subcapa** o **densidad radial**.
- **Cortes** de la nube (mitad o lámina, siempre orientados hacia la cámara) para ver los nodos radiales.
- **Electrones simulados**: paseos aleatorios de Metropolis que recorren |ψ|² y dejan estela.
- Gráfica de la distribución radial P(r) = r²|R|² con nodos y radio más probable.
- Rotación libre o automática, vistas por ejes, núcleo con protones y neutrones, resplandor (bloom), capturas PNG y enlaces compartibles (el estado se guarda en la URL).

Atajos: `T` tabla periódica · `←`/`→` elemento anterior/siguiente · `Espacio` rotación automática.

## Ejecutar en local

No necesita compilación. Basta con servir la carpeta:

```bash
python3 -m http.server 8000
```

y abrir http://localhost:8000.
