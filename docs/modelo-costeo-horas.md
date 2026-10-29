# Modelo matemático de costeo de horas — servicios DeltaV

Versión 0.1.0 · Implementación de referencia en [`costing/`](../costing/README.md)

## 1. Objetivo

Estimar, de manera reproducible y trazable, las **horas-persona** de servicios de ingeniería para
sistemas DeltaV, separadas en **oficina**, **taller** y **sitio**, para cualquier alcance: planta
nueva, expansión, migración o trabajos menores (modificación de pantallas o lógica, suministro de
gabinetes, integración de materiales, reemplazo de componentes, soporte). El modelo:

- parte de **cantidades físicas del alcance** (drivers), muchas de las cuales provienen directamente
  de la herramienta de gabinetes;
- aplica una **misma fórmula** a un catálogo de actividades; las plantillas por tipo de proyecto sólo
  deciden qué actividades se activan y con qué valores por defecto;
- modela explícitamente **similitud** (típicos y clones), **aprendizaje**, **reúso** del sistema
  existente, **transferencia de calidad** FAT → comisionamiento y **dimensionamiento de cuadrillas**;
- entrega **incertidumbre** (σ, P80, P90) y **contingencia** según tipo de emisión.

Todos los valores numéricos del catálogo y de parámetros son semillas razonables de la industria, no
estándares. Están concentrados en dos archivos para calibrarlos con datos históricos (§12).

## 2. Estructura

```
             ┌────────────────┐    ┌──────────────┐    ┌──────────────────┐
 Herramienta │ gabinetes[]    │    │ alcance[]    │    │ drivers {}       │  entradas
 de gabinetes│ (contrato §11) │    │ (ítems menores)│  │ (manuales)       │
             └───────┬────────┘    └──────┬───────┘    └────────┬─────────┘
                     └──────────┬─────────┴───────────────────┘
                                ▼
                    drivers normalizados {n, k únicos} + derivados
                                ▼
       catálogo de actividades × plantilla del tipo de proyecto × factores globales
                                ▼
   actividades directas → derivadas (%, grupos) → calendario de sitio → gestión/calidad
                                ▼
   horas por actividad / lugar / fase / rol · días, cuadrillas, viajes, viáticos · σ, P80 · contingencia · costo
```

Cada actividad `a` tiene un **lugar** ℓ(a) ∈ {OFICINA, TALLER, SITIO}, una **fase** (definición,
ingeniería HW/SW, pruebas, documentación, fabricación, montaje, pre‑com, cutover, com, SAT, PEM,
capacitación, servicio…) y un **rol** (GP, LI, IS, IH, DT, QA, TT, IC, TS, INST) para aplicar tarifas.

## 3. Entrada

```jsonc
{
  "proyecto":  { "nombre": "", "propuesta": "", "version": "", "emision": "Emisión Presupuestaria | Emisión a Firme" },
  "tipo":      "PLANTA_NUEVA | EXPANSION | MIGRACION | TRABAJO_MENOR",
  "factores":  { "complejidad": "BAJA|MEDIA|ALTA|MUY_ALTA", "nivelDocumentacion": "BASICO|ESTANDAR|RIGUROSO",
                 "libreriaTipicos": "SIN|PARCIAL|COMPLETA", "condicionesSitio": "NORMAL|EXIGENTE|SEVERA" },
  "gabinetes": [ /* salida de la herramienta de gabinetes, §11 */ ],
  "alcance":   [ /* ítems de trabajo menor, §10 */ ],
  "drivers":   { "modulos_medios": { "total": 260, "unicos": 60 }, "alarmas": 1500, "dias_pem": 15 },
  "sitio":     { "incluir": true, "coberturaFAT": 0.8, "rotacionDias": 20, "horasViajeIda": 8,
                 "presenciaLider": 1.0, "personasPem": 1, "fases": { "PRECOM": { "personas": 4, "diasObjetivo": 20 } } },
  "actividades": { "excluir": [], "incluir": [], "overrides": { "DOC_FDS": { "fijo": 40 } } },
  "parametros":  { /* sobreescritura profunda de parametros.js */ },
  "duracionSemanas": null,
  "tarifas":   { "GP": 95, "IS": 75, "defecto": 70, "viatico": 150, "viaje": 900, "moneda": "USD" }
}
```

Las tres fuentes de drivers (`gabinetes`, `alcance`, `drivers`) **se suman**. Un driver puede ser un
número `n` o `{ total: n, unicos: k }`.

## 4. Variables (drivers)

| Grupo | Drivers | Fuente habitual |
|---|---|---|
| E/S | `io_AI io_AO io_DI io_DO io_RTD_TC io_HART io_FF io_PROFIBUS io_SERIE_MODBUS io_OPC` | herramienta de gabinetes (tarjetas) |
| Hardware | `controladores estaciones switches gabinetes tarjetas componentes terminaciones` | herramienta de gabinetes |
| Software | `modulos_simples modulos_medios modulos_complejos fases_secuencia unidades_batch sif graficos_* alarmas alarmas_racionalizar interfaces_terceros reportes` | listado de lazos / P&ID |
| Documentos y capacitación | `documentos_entregables cursos_capacitacion` | plantilla (defecto) o manual |
| Modificaciones | `graficos_mod_S/M/L modulos_mod_* fases_mod componentes_integrar terminaciones_integrar reemplazo_* io_afectado gabinetes_afectados` | ítems de `alcance` |
| Sitio | `dias_pem dias_supervision_montaje` | manual |

Derivados automáticos: `io_fisico`, `io_bus`, `puntos_interfaz`, `io_total`, `modulos_total`,
`graficos_total`, `graficos_mod_total`, `modulos_mod_total`, `nodos`.

## 5. Fórmula general de una actividad directa

Para cada actividad activa `a`:

$$
H_a \;=\; \Big[\, F_a \;+\; \sum_{d \in D(a)} u_{a,d}\; n^{\text{ef}}_{a,d} \,\Big]\cdot M_a \cdot \prod_{f \in \Phi(a)} m_f \cdot T_a
$$

| Símbolo | Significado |
|---|---|
| $F_a$ | horas fijas de la actividad (setup, reuniones). **Se cobran una sola vez por proyecto**, sin importar cuántos ítems de alcance la disparen. Si `fijoCondicional`, sólo cuando Σ términos > 0. |
| $u_{a,d}$ | horas unitarias del driver $d$ en la actividad $a$ (catálogo) |
| $n^{\text{ef}}_{a,d}$ | cantidad efectiva del driver, tras similitud y aprendizaje (§6); si el término no declara `clon`, $n^{\text{ef}} = n_d$ |
| $M_a$ | multiplicador fijo (p. ej. 2 personas en FAT presenciada) |
| $m_f$ | factores globales que aplican a la actividad (§7) |
| $T_a$ | transferencia FAT → COM, sólo en actividades marcadas (§9.6) |

Un término puede condicionarse: `siCero: 'dias_supervision_montaje'` (aplica sólo si ese otro
driver es 0 — permite "si el usuario fija días, úsalos; si no, derívalos de gabinetes y nodos") y
`plantillas: ['MIGRACION']` (aplica sólo a ese tipo de proyecto).

## 6. Similitud y aprendizaje

En DeltaV el trabajo repetitivo se resuelve con **clases / típicos**: la primera instancia cuesta
el esfuerzo completo y las demás una fracción. Además, hacer $k$ ítems *distintos pero parecidos*
tiene curva de aprendizaje. Para un driver con $n$ ítems de los cuales $k$ son únicos:

$$
n^{\text{ef}} = k^{\,1-b} \;+\; \rho\,(n-k), \qquad b = -\log_2(LR)
$$

- $\rho$ (`clon`): costo relativo de una copia (0,2 para módulos; 0,3 gráficos; 0,85 armado de gabinete, porque armar un gabinete idéntico casi no ahorra).
- $LR$: tasa de aprendizaje de Wright (0,9 ⇒ cada duplicación de la cantidad baja el promedio un 10 %). Con $LR=1$, $k^{1-b}=k$.
- Si el usuario no informa $k$: $k = \lceil \varphi\, n \rceil$, con $\varphi$ por familia (módulos, gráficos, gabinetes, interfaces, secuencias) y por tipo de proyecto (`parametros.similitud.phi`). Una expansión tiene menos únicos (reutiliza típicos) que una planta nueva.

**Ejemplo.** 260 módulos medios, 60 únicos, $u=4$ h, $\rho=0{,}2$, $LR=0{,}9$ ($b=0{,}152$), librería PARCIAL (0,85):

$n^{\text{ef}} = 60^{0{,}848} + 0{,}2\cdot 200 = 32{,}2 + 40 = 72{,}2$ → $H = 72{,}2 \cdot 4 \cdot 0{,}85 = 245{,}5$ h
(frente a $260\cdot 4 = 1040$ h sin similitud). Este caso está verificado en `costing/test/test.js`.

Para gabinetes, la herramienta de gabinetes informa la clave de diseño (`plantilla`); el adaptador
cuenta únicos por firma (tipo + lista de tarjetas) cuando no hay clave.

## 7. Factores globales

| Factor | Valores | Aplica a |
|---|---|---|
| `complejidad` | BAJA 0,85 · MEDIA 1 · ALTA 1,25 · MUY_ALTA 1,5 | configuración, FDS, interfaces, COM |
| `nivelDocumentacion` | BASICO 0,8 · ESTANDAR 1 · RIGUROSO 1,3 | documentos, planos, protocolos, pruebas, QA |
| `libreriaTipicos` | SIN 1 · PARCIAL 0,85 · COMPLETA 0,7 | configuración de módulos, gráficos, BD |
| `condicionesSitio` | NORMAL 1 · EXIGENTE 1,15 · SEVERA 1,3 | todo sitio |
| `reusoSoftware` (por tipo) | NUEVA 1 · EXPANSION 0,85 · MIGRACION 0,75 · MENOR 0,9 | software |
| `reusoHardware` (por tipo) | NUEVA 1 · EXPANSION 0,9 · MIGRACION 0,95 · MENOR 1 | hardware |
| `brownfield` (por tipo) | NUEVA 1 · EXPANSION 1,15 · MIGRACION 1,25 · MENOR 1,1 | sitio (planta operando) |
| `modoLoopCheck` | EJECUTA 1 · APOYA 0,3 (defecto APOYA en planta nueva y migración, EJECUTA en expansión y menor) | pruebas de lazo en sitio: quién pone la pareja de terreno |

Los factores son multiplicativos e independientes; cada actividad del catálogo declara cuáles le
aplican, de modo que un cambio de nivel documental no infla el armado de gabinetes, por ejemplo.

## 8. Actividades derivadas

Se evalúan en orden sobre lo ya calculado:

| Orden | Actividad | Fórmula |
|---|---|---|
| 1 | `PRU_INTERNAS` | 25 % de las horas del grupo `SW_CONFIG` |
| 1 | `DOC_ASBUILT` | 8 h + 15 % del grupo `PLANOS` |
| 2 | `SIT_LIDER_TECNICO` | $h_{día} \cdot D_{cal} \cdot \pi$ (§9.4) |
| 2 | `SIT_MOVILIZACION` | $2 \cdot h_{viaje} \cdot V$ (§9.5) |
| 3 | `GP_GESTION` | 10 % (menor: 8 %) de todo lo no‑sitio + 4 h/semana de duración |
| 3 | `QA_CALIDAD` | 3 % de todo lo no‑sitio |

Duración estimada (para el término por semana): equipo $= \text{clamp}(\lceil H_{no\,sitio}/400\rceil, 1, 8)$;
$W = \lceil H_{no\,sitio}/(\text{equipo}\cdot 32)\rceil + D_{cal}/5$. Puede fijarse con `duracionSemanas`.

## 9. Modelo de sitio

### 9.1 Fases y cuadrillas
Las actividades de sitio se agrupan por fase en secuencia: MONTAJE → SERVICIO → PRECOM → CUTOVER →
COM → SAT → PEM → CAPACITACION. Cada fase $\varphi$ tiene una cuadrilla de $c_\varphi$ personas, con
eficiencia decreciente por coordinación (ley de Brooks simplificada):

$$ e(c) = \max\big(e_{min},\; 1 - \kappa\,(c-1)\big), \qquad \kappa = 0{,}05,\; e_{min}=0{,}6 $$

### 9.2 Días por fase y dimensionamiento automático
$$ D_\varphi = \Big\lceil \frac{H_\varphi}{c_\varphi \cdot h_{día} \cdot e(c_\varphi)} \Big\rceil $$

La plantilla da para cada fase una cuadrilla **mínima** y un **objetivo de días**; el motor agranda
$c_\varphi$ (hasta `personasMaximas`) hasta cumplir el objetivo. Así, el loop‑check de una planta de
2000 E/S se resuelve con 3 parejas en ~50 días en lugar de 1 pareja en 120. El usuario puede forzar
`personas` o `diasObjetivo` por fase, o pedir al optimizador el tamaño de mínimo costo (§13.7).

**Ajuste a jornadas completas.** La cuadrilla está días enteros: se agrega una fila
`SIT_AJUSTE_<fase>` con $c\,h\,D_\varphi - H_\varphi$ para que la suma de actividades coincida con lo
realmente facturable. Para trabajos menores (`calendarioUnificado`) una sola cuadrilla hace todas las
fases de corrido y el redondeo ocurre una vez.

### 9.3 Calendario con solapes
$$ D_{cal} = \Big\lceil \sum_\varphi D_\varphi - \sum_\varphi s_\varphi \min(D_\varphi, D_{\varphi-1}) \Big\rceil $$
con $s_\varphi$ la fracción de solape con la fase anterior (PRECOM‑COM 0,3; capacitación 0,5).

### 9.4 Líder técnico
$H_{LT} = h_{día}\cdot \lceil \pi\, D_{cal}\rceil$, con presencia $\pi$ = 1 en planta nueva/migración,
0,5 en expansión y 0 en trabajos menores (el ingeniero de comisionamiento ejerce de líder).

### 9.5 Movilización y viáticos
Los viajes se cuentan por **puesto de cuadrilla**, no por fase: el puesto $i$ está presente en todas
las fases con $c_\varphi \ge i$ y la misma persona encadena fases consecutivas, rotando cada $R$ días:

$$ V = \sum_{i=1}^{\max c_\varphi} \Big\lceil \tfrac{1}{R}\sum_{\varphi:\,c_\varphi \ge i} D_\varphi \Big\rceil \;+\; \lceil \lceil\pi D_{cal}\rceil / R \rceil $$

Horas de viaje $= 2\,h_{viaje}\,V$. Días de viático $= \sum_\varphi c_\varphi D_\varphi + \lceil\pi D_{cal}\rceil + V\cdot d_{viaje}$.

### 9.6 Transferencia FAT → COM
Lo que se prueba bien en FAT no se vuelve a descubrir en campo:
$$ H_{COM} = H^0_{COM}\,(1 - \tau\,\gamma_{FAT}), \qquad \tau = 0{,}3,\; \gamma_{FAT}\in[0,1] $$
con cobertura por defecto 0,8 (nueva), 0,6 (expansión/migración), 0 (menor).

### 9.7 Trabajos sin sitio
`sitio.incluir = false` anula todo el bloque. Si todos los ítems de alcance son modificaciones con
`despliegue: 'REMOTO'`, el despliegue y la aceptación pasan a oficina y no hay viajes.

## 10. Tipos de proyecto y trabajos menores

| Plantilla | Qué activa / desactiva | Defectos |
|---|---|---|
| PLANTA_NUEVA | todo salvo modificaciones, migración y cutover | $\varphi_{mod}=0{,}3$, FAT 0,8, 14 documentos, 10 días PEM, líder 100 % |
| EXPANSION | reúso SW 0,85 / HW 0,9, brownfield 1,15; cutover; setup y FDS reducidos | $\varphi_{mod}=0{,}2$, FAT 0,6, 10 documentos, 5 días PEM, líder 50 % |
| MIGRACION | + `SW_MIGRACION_BD` (conversión), cutover pesado, brownfield 1,25 | reúso SW 0,75 (la conversión cubre parte), 14 documentos |
| TRABAJO_MENOR | sin FDS, arquitectura, FAT ni manuales; fijos mínimos; gestión 8 % | cuadrilla única, líder 0, 3 documentos, FAT 0 |

Ítems de `alcance` (se traducen a drivers; varios ítems comparten los fijos):

| `tipo` | Campos | Drivers resultantes |
|---|---|---|
| `MOD_PANTALLA` | tamano S/M/L, cantidad, despliegue | `graficos_mod_*` |
| `MOD_LOGICA` | complejidad SIMPLE/MEDIA/COMPLEJA/SECUENCIA, cantidad, despliegue | `modulos_mod_*`, `fases_mod` |
| `NUEVO_IO` | AI, AO, DI, DO, RTD_TC, HART, módulos por clase | `io_*`, `modulos_*` |
| `INTEGRACION_MATERIALES` | componentes, terminaciones, gabinetesAfectados | `componentes_integrar`, `terminaciones_integrar`, `gabinetes_afectados` |
| `REEMPLAZO_COMPONENTE` | componente TARJETA/CONTROLADOR/ESTACION, cantidad, ioAfectado | `reemplazo_*`, `io_afectado` |
| `SUMINISTRO_GABINETE` | cantidad, unicos, componentes/terminaciones por gabinete | `gabinetes`, `componentes`, `terminaciones` (preferir `gabinetes[]`) |
| `SOPORTE_SITIO` / `SUPERVISION_MONTAJE` | días, personas | `dias_pem`, `dias_supervision_montaje` |
| `CAPACITACION` / `DOCUMENTO` | cursos / cantidad | `cursos_capacitacion`, `documentos_entregables` |

Un proyecto mixto (p. ej. gabinete nuevo + pantallas + reemplazo) es simplemente una lista con varios
ítems: los fijos (gestión, kick‑off, control documental, protocolo) se cuentan una vez y el sitio se
resuelve con una sola cuadrilla y un solo viaje si cabe en la rotación.

## 11. Integración con la herramienta de gabinetes

Contrato de entrada (`gabinetes[]`, ver cabecera de `costing/gabinetes.js`):

```jsonc
{ "id": "SYS-01", "tipo": "SISTEMA|MARSHALLING|REMOTO|RED|OTRO", "plantilla": "SYS-A", "existente": false,
  "tarjetas": [ { "modelo": "AI-8-HART", "cantidad": 12 }, { "modelo": "FF-H1-2P", "cantidad": 2, "dispositivos": 12 } ],
  "io": { "AI": 96, "DI": 192 },            // alternativa a tarjetas
  "controladores": 2, "cioc": 0, "estaciones": 0, "switches": 2,
  "componentes": 85, "terminaciones": 640, "interfaces": 0 }
```

El adaptador produce: `gabinetes {total, unicos}` (únicos por `plantilla` o firma de tarjetas),
`gabinetes_afectados` (los `existente`), `tarjetas`, `componentes`, `terminaciones`, `io_*`,
`controladores` (+CIOC), `estaciones`, `switches`, `interfaces_terceros`. Si la herramienta no informa
componentes o terminaciones, se estiman (`ESTIMACION`) — conviene que los informe, porque el cableado
de taller (0,15 h/terminación) y los planos de conexionado (0,4 h/E/S) son los términos dominantes de
un suministro de gabinetes.

Lo que la herramienta de gabinetes debería exponer para aprovechar al máximo el modelo:
1. lista de gabinetes con `plantilla` (clave de diseño) para contar clones;
2. lista de tarjetas con modelo del catálogo (o `canales` + `senal`), y `dispositivos` en tarjetas de bus;
3. conteo real de componentes BOM y terminaciones (ambos extremos de cada conductor);
4. marca `existente` en gabinetes a intervenir (cutover / integración).

Sentido inverso: el modelo devuelve `gabinetes[].detalle` con E/S, firma y si es clon, útil para
mostrar en la herramienta de gabinetes el costo de horas de cada gabinete.

## 12. Incertidumbre, contingencia y costo

**PERT.** Cada parámetro puede darse como tres puntos $(o, m, p)$: $\mu = (o+4m+p)/6$,
$\sigma = (p-o)/6$. Un número suelto $m$ se expande con el rango relativo por lugar
(oficina −15 %/+35 %, taller −10 %/+25 %, sitio −20 %/+50 %). La actividad hereda media y varianza por
linealidad (los multiplicadores escalan ambas). El total usa correlación equicorrelacionada $r$ (0,3)
para no subestimar el riesgo sistémico:

$$ \sigma_{tot}^2 = (1-r)\sum_a \sigma_a^2 + r\Big(\sum_a \sigma_a\Big)^2, \qquad P_{80} = \mu_{tot} + 0{,}8416\,\sigma_{tot} $$

Las horas reportadas como "horas" son la moda (lo que dice el catálogo); media, σ, P80 y P90 van en
`incertidumbre`.

**Contingencia** por tipo de emisión, enlazada al campo *Emisión* del add‑in: Presupuestaria 15 %,
A Firme 8 %. Alternativamente puede usarse $P_{80}-H$ como contingencia basada en riesgo.

**Costo.** $C = \sum_r H_r \tau_r + V\, c_{viaje} + D_{viático}\, c_{viático}$, más contingencia.

## 13. Mecanismos de optimización incluidos

1. **Fijos una sola vez**: combinar trabajos en un proyecto comparte gestión, kick‑off, control documental, protocolos y soporte.
2. **Similitud**: típicos y clones (§6); informar `unicos` desde el listado de lazos o la clave de diseño de gabinetes baja la estimación de forma defendible.
3. **Aprendizaje** sobre ítems únicos de la misma familia.
4. **Reúso** de estándares del sistema existente (expansión) y de la conversión automática (migración).
5. **Transferencia FAT → COM**: invertir en cobertura de FAT reduce horas de sitio (más caras, con viáticos).
6. **Dimensionamiento de cuadrillas** por objetivo de días, con penalización de eficiencia por coordinación.
7. **Optimizador de costo** (`optimizarCuadrillas`): búsqueda fase por fase del tamaño de cuadrilla que minimiza horas × tarifa + viáticos + viajes, considerando que una cuadrilla más grande acorta el calendario y, con él, al líder técnico.
8. **Viajes encadenados** por puesto de cuadrilla y **calendario unificado** en trabajos menores.
9. **Despliegue remoto** de modificaciones: elimina el bloque de sitio completo.

## 14. Calibración

1. Registrar horas reales por actividad del catálogo (los `id` sirven como códigos de imputación) y los drivers reales al cierre de cada proyecto.
2. Para cada actividad, calcular el cociente real/modelo; con ≥ 5 proyectos, ajustar $u_{a,d}$ y $F_a$ por mínimos cuadrados sobre $H_a = F_a + \sum_d u_{a,d}\, n^{\text{ef}}_{a,d}$ (regresión lineal en los $n^{\text{ef}}$; los factores globales se fijan primero).
3. Revisar $\varphi$ (fracción de únicos) y $\rho$ comparando el conteo de clases únicas en la base de datos DeltaV final.
4. Ajustar los rangos relativos PERT con la dispersión observada de real/modelo.
5. Versionar `parametros.js` y `catalogo.js` (campo `version`) y guardar en cada propuesta la versión usada: el resultado incluye `version` y la trazabilidad de cada término.

## 15. Salida

`calcular(entrada)` devuelve: `actividades[]` (horas, media, σ, fijo, términos con $n$, únicos,
$n^{\text{ef}}$, unitario, factores aplicados), `horas` (total, porLugar, porFase, porRol), `sitio`
(fases con cuadrilla, eficiencia, días; días calendario; líder; viajes por puesto; días de viático),
`duracion`, `incertidumbre`, `contingencia`, `drivers` consolidados, `gabinetes` (detalle), `avisos`.
`costear(resultado, tarifas)` convierte a moneda; `reporteTexto` imprime una tabla trazable;
`optimizarCuadrillas` devuelve `personasPorFase` y el resultado optimizado.

## 16. Limitaciones y próximos pasos

- Los valores unitarios son semillas: calibrar antes de usarlos en emisiones a firme.
- La incertidumbre ignora el redondeo a días enteros y supone correlación uniforme.
- El dimensionamiento de cuadrillas no modela restricciones de ventanas de parada ni disponibilidad del cliente; se cubren con `diasObjetivo`/`personas` por fase.
- Integración pendiente en el add‑in: una vista "Horas de servicio" que lea `gabinetes` de la herramienta de gabinetes, el campo *Emisión* para la contingencia y escriba la tabla de horas por lugar/fase/rol en el documento Word mediante content controls, igual que hoy se sincroniza la tabla de revisiones.
