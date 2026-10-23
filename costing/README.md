# Modelo de costeo de horas — servicios DeltaV

Motor paramétrico para estimar horas-persona de **oficina**, **taller** y **sitio** en proyectos de
sistemas de control DeltaV: plantas nuevas, expansiones, migraciones y trabajos menores
(modificación de pantallas/lógica, suministro de gabinetes, integración de materiales,
reemplazo de componentes, soporte).

La formulación matemática completa está en [`docs/modelo-costeo-horas.md`](../docs/modelo-costeo-horas.md).

## Archivos

| Archivo | Contenido |
|---|---|
| `parametros.js` | Semillas calibrables: factores, similitud/aprendizaje, cuadrillas, movilización, contingencia, incertidumbre, roles. |
| `catalogo.js` | Catálogo de actividades (matriz actividad × driver) y lista de drivers. |
| `plantillas.js` | Plantillas por tipo de proyecto, fases de sitio y mapeo de ítems de alcance a drivers. |
| `gabinetes.js` | Adaptador de la salida de la herramienta de gabinetes → drivers. Catálogo mínimo de tarjetas. |
| `motor.js` | `calcular`, `costear`, `optimizarCuadrillas`, `reporteTexto`. |
| `cli.js` | `node costing/cli.js ejemplos/planta-nueva.json [--json] [--optimizar]` |
| `ejemplos/` | Entradas de ejemplo para cada tipo de proyecto. |
| `test/test.js` | Pruebas: `node costing/test/test.js` |

Sin dependencias. Los módulos funcionan en Node (`require`) y en el navegador / add-in de Word
(cargar los cinco archivos en orden; quedan en `window.DeltaVCosteo`).

## Uso mínimo

```js
const { calcular, costear, reporteTexto } = require('./costing/motor.js');

const r = calcular({
  tipo: 'EXPANSION',
  proyecto: { nombre: 'Unidad 200', emision: 'Emisión a Firme' },
  factores: { complejidad: 'MEDIA', nivelDocumentacion: 'RIGUROSO', libreriaTipicos: 'COMPLETA' },
  gabinetes: [ /* salida de la herramienta de gabinetes */ ],
  drivers: { modulos_medios: { total: 50, unicos: 12 }, graficos_proceso: 4, dias_pem: 5 }
});
console.log(reporteTexto(r, costear(r, { defecto: 75, viatico: 150, viaje: 600 })));
```

Salida: horas por actividad (con trazabilidad de la fórmula), por lugar, fase y rol; calendario
de sitio (días, cuadrillas, viajes, viáticos); duración; incertidumbre (σ, P80, P90); contingencia.
