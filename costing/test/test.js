/**
 * Pruebas del modelo (sin dependencias): node costing/test/test.js
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const motor = require('../motor.js');
const GAB = require('../gabinetes.js');

const ejemplo = (n) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'ejemplos', n), 'utf8'));
const casi = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} esperado ${b} ±${tol}, obtenido ${a}`);
const sumaObj = (o) => Object.values(o).reduce((s, v) => s + v, 0);
let pasadas = 0;
function test(nombre, fn) { fn(); pasadas++; console.log('  ✓ ' + nombre); }

console.log('PERT y similitud');
test('pert: número → moda igual al valor, media > moda con rango asimétrico', () => {
  const p = motor.pert(10, 'OFICINA', motor.PARAMETROS);
  assert.strictEqual(p.moda, 10); assert.ok(p.media > 10); assert.ok(p.sigma > 0);
});
test('pert: tres puntos', () => {
  const p = motor.pert({ o: 6, m: 10, p: 20 }, 'OFICINA', motor.PARAMETROS);
  casi(p.media, (6 + 40 + 20) / 6, 1e-9); casi(p.sigma, 14 / 6, 1e-9);
  const q = motor.pert([6, 10, 20], 'SITIO', motor.PARAMETROS); casi(q.media, p.media, 1e-9);
});
test('cantidadEfectiva: sin aprendizaje ni clones = n', () => { casi(motor.cantidadEfectiva(50, 50, 1, 1), 50, 1e-9); });
test('cantidadEfectiva: clones a costo rho', () => { casi(motor.cantidadEfectiva(100, 20, 0.25, 1), 20 + 0.25 * 80, 1e-9); });
test('cantidadEfectiva: aprendizaje reduce únicos (60 únicos, LR 0.9 → ≈32.2)', () => { casi(motor.cantidadEfectiva(60, 60, 0.2, 0.9), 32.2, 0.1); });
test('cantidadEfectiva: monótona en n', () => { assert.ok(motor.cantidadEfectiva(200, 40, 0.2, 0.9) > motor.cantidadEfectiva(100, 40, 0.2, 0.9)); });

console.log('Consistencia de agregados');
['planta-nueva.json', 'expansion.json', 'migracion.json', 'menor-pantallas.json', 'menor-gabinete.json', 'menor-integracion.json', 'menor-reemplazo.json'].forEach(n => {
  test(`${n}: Σ actividades = total = Σ lugar = Σ rol = Σ fase`, () => {
    const r = motor.calcular(ejemplo(n));
    const sumAct = r.actividades.reduce((s, a) => s + a.horas, 0);
    casi(sumAct, r.horas.total, 0.5 + r.actividades.length * 0.05);
    casi(sumaObj(r.horas.porLugar), r.horas.total, 0.5);
    casi(sumaObj(r.horas.porRol), r.horas.total, 1.5);
    casi(sumaObj(r.horas.porFase), r.horas.total, 2);
    assert.ok(r.horas.total > 0);
    assert.ok(r.incertidumbre.P80 >= r.incertidumbre.media);
    assert.ok(r.contingencia.totalConContingencia > r.horas.total);
  });
});

console.log('Comportamientos del modelo');
test('similitud: informar únicos reduce horas frente a todo único', () => {
  const base = { tipo: 'PLANTA_NUEVA', drivers: { modulos_medios: { total: 100, unicos: 100 } } };
  const sim = { tipo: 'PLANTA_NUEVA', drivers: { modulos_medios: { total: 100, unicos: 20 } } };
  const a = motor.calcular(base).actividades.find(x => x.id === 'SW_MODULOS_MEDIOS').horas;
  const b = motor.calcular(sim).actividades.find(x => x.id === 'SW_MODULOS_MEDIOS').horas;
  assert.ok(b < a * 0.6, `${b} debería ser mucho menor que ${a}`);
});
test('similitud: ejemplo documentado SW_MODULOS_MEDIOS 260/60 únicos, librería PARCIAL ≈ 245.5 h', () => {
  const r = motor.calcular({ tipo: 'PLANTA_NUEVA', factores: { libreriaTipicos: 'PARCIAL' }, drivers: { modulos_medios: { total: 260, unicos: 60 } } });
  casi(r.actividades.find(x => x.id === 'SW_MODULOS_MEDIOS').horas, 245.5, 1.0);
});
test('fijos se cobran una sola vez aunque haya varios ítems de alcance', () => {
  const uno = motor.calcular({ tipo: 'TRABAJO_MENOR', alcance: [{ tipo: 'MOD_PANTALLA', tamano: 'M', cantidad: 1, despliegue: 'REMOTO' }] });
  const dos = motor.calcular({ tipo: 'TRABAJO_MENOR', alcance: [{ tipo: 'MOD_PANTALLA', tamano: 'M', cantidad: 1, despliegue: 'REMOTO' }, { tipo: 'MOD_PANTALLA', tamano: 'M', cantidad: 1, despliegue: 'REMOTO' }] });
  const f1 = uno.actividades.find(x => x.id === 'DOC_PROTOCOLOS'), f2 = dos.actividades.find(x => x.id === 'DOC_PROTOCOLOS');
  assert.strictEqual(f1.fijo, f2.fijo);
  casi(f2.horas - f1.horas, 0.3 * f1.factorTotal, 0.05); // sólo el término variable (0.3 h/gráfico)
});
test('fijo condicional no se cobra sin drivers', () => {
  const r = motor.calcular({ tipo: 'PLANTA_NUEVA', drivers: { io_AI: 10 } });
  assert.ok(!r.actividades.find(x => x.id === 'SW_BATCH'));
  assert.ok(!r.actividades.find(x => x.id === 'SW_SIS'));
});
test('despliegue remoto de modificaciones → sin horas de sitio ni viajes', () => {
  const r = motor.calcular(ejemplo('menor-pantallas.json'));
  assert.strictEqual(r.horas.porLugar.SITIO, 0); assert.strictEqual(r.sitio.viajes, 0);
  assert.ok(r.actividades.find(x => x.id === 'SIT_DESPLIEGUE_MODIFICACIONES').lugar === 'OFICINA');
});
test('sitio.incluir=false anula todas las actividades de sitio', () => {
  const e = ejemplo('planta-nueva.json'); e.sitio = { incluir: false };
  const r = motor.calcular(e); assert.strictEqual(r.horas.porLugar.SITIO, 0); assert.strictEqual(r.sitio.diasCalendario, 0);
});
test('expansión reutiliza: menos horas de software que planta nueva con los mismos drivers', () => {
  const d = { modulos_medios: 100, graficos_proceso: 10, io_AI: 100 };
  const pn = motor.calcular({ tipo: 'PLANTA_NUEVA', drivers: d, actividades: { excluir: ['SW_SETUP_SISTEMA'] } }).horas.porFase.INGENIERIA_SW;
  const ex = motor.calcular({ tipo: 'EXPANSION', drivers: d, actividades: { excluir: ['SW_SETUP_SISTEMA'] } }).horas.porFase.INGENIERIA_SW;
  assert.ok(ex < pn, `${ex} < ${pn}`);
});
test('transferencia FAT: mayor cobertura FAT reduce horas de COM en sitio', () => {
  const d = { tipo: 'PLANTA_NUEVA', drivers: { modulos_medios: 100 } };
  const sin = motor.calcular(Object.assign({}, d, { sitio: { coberturaFAT: 0 } })).actividades.find(x => x.id === 'SIT_COM_FUNCIONAL').horas;
  const con = motor.calcular(Object.assign({}, d, { sitio: { coberturaFAT: 1 } })).actividades.find(x => x.id === 'SIT_COM_FUNCIONAL').horas;
  casi(con, sin * (1 - motor.PARAMETROS.transferenciaFAT.tau), 0.5);
});
test('contingencia: alias del add-in "Emisión a Firme" → 8 %', () => {
  const r = motor.calcular({ tipo: 'TRABAJO_MENOR', proyecto: { emision: 'Emisión a Firme' }, drivers: { graficos_mod_S: 1 } });
  assert.strictEqual(r.contingencia.emision, 'FIRME'); assert.strictEqual(r.contingencia.porcentaje, 0.08);
});
test('gestión = 10 % de no-sitio + 4 h/semana', () => {
  const r = motor.calcular(ejemplo('planta-nueva.json'));
  const gp = r.actividades.find(x => x.id === 'GP_GESTION');
  const noSitioSinGP = r.actividades.filter(x => x.lugar !== 'SITIO' && x.id !== 'GP_GESTION' && x.id !== 'QA_CALIDAD').reduce((s, x) => s + x.horas, 0);
  casi(gp.horas, 0.10 * noSitioSinGP + 4 * r.duracion.semanasTotales, 2);
});
test('cuadrillas: se agrandan hasta cumplir diasObjetivo y respetan el máximo', () => {
  const r = motor.calcular(ejemplo('planta-nueva.json'));
  const precom = r.sitio.fases.find(f => f.fase === 'PRECOM');
  assert.ok(precom.personas > 2 && precom.personas <= motor.PARAMETROS.cuadrillas.personasMaximas);
  const r2 = motor.calcular(motor.deepMerge(ejemplo('planta-nueva.json'), { sitio: { fases: { PRECOM: { personas: 2 } } } }));
  assert.strictEqual(r2.sitio.fases.find(f => f.fase === 'PRECOM').personas, 2);
  assert.ok(r2.sitio.diasCalendario > r.sitio.diasCalendario);
});
test('ajuste a jornadas completas: horas calendario de cada fase = personas × días × h', () => {
  const r = motor.calcular(ejemplo('expansion.json'));
  r.sitio.fases.forEach(f => {
    const acts = r.actividades.filter(a => a.lugar === 'SITIO' && a.fase === f.fase && (a.tipo === 'DIRECTA' || a.tipo === 'AJUSTE'));
    casi(acts.reduce((s, a) => s + a.horas, 0), f.personas * f.dias * f.horasDia, 0.5, f.fase);
  });
});
test('viajes por puesto: una persona encadena fases (trabajo menor de 7 días → 1 viaje)', () => {
  const r = motor.calcular(ejemplo('menor-reemplazo.json'));
  assert.ok(r.sitio.unificado); assert.strictEqual(r.sitio.viajes, 1); assert.strictEqual(r.sitio.diasLider, 0);
});
test('tipo de proyecto desconocido lanza error', () => { assert.throws(() => motor.calcular({ tipo: 'XX' })); });
test('driver desconocido genera aviso pero no error', () => {
  const r = motor.calcular({ tipo: 'TRABAJO_MENOR', drivers: { inventado: 3 } });
  assert.ok(r.avisos.some(a => a.includes('inventado')));
});

console.log('Gabinetes (adaptador)');
test('tarjetas → E/S, clones por plantilla, existentes → afectados', () => {
  const g = GAB.aDrivers([
    { id: 'A', tipo: 'SISTEMA', plantilla: 'X', controladores: 2, tarjetas: [{ modelo: 'AI-8-HART', cantidad: 4 }, { modelo: 'DI-32', cantidad: 2 }] },
    { id: 'B', tipo: 'SISTEMA', plantilla: 'X', controladores: 2, tarjetas: [{ modelo: 'AI-8-HART', cantidad: 4 }, { modelo: 'DI-32', cantidad: 2 }] },
    { id: 'C', tipo: 'SISTEMA', existente: true },
    { id: 'D', tipo: 'SISTEMA', tarjetas: [{ modelo: 'FF-H1-2P', cantidad: 2, dispositivos: 10 }, { modelo: 'SERIAL-2P', cantidad: 1 }] }
  ]);
  assert.strictEqual(g.drivers.io_AI, 64); assert.strictEqual(g.drivers.io_HART, 64); assert.strictEqual(g.drivers.io_DI, 128);
  assert.strictEqual(g.drivers.io_FF, 20); assert.strictEqual(g.drivers.interfaces_terceros, 2);
  assert.deepStrictEqual(g.drivers.gabinetes, { total: 3, unicos: 2 }); assert.strictEqual(g.drivers.gabinetes_afectados, 1);
  assert.strictEqual(g.drivers.controladores, 4);
  assert.ok(g.detalle[1].esClon && !g.detalle[0].esClon);
  assert.ok(g.drivers.terminaciones > 0 && g.drivers.componentes > 0);
});
test('tarjeta fuera de catálogo sin canales → aviso', () => {
  const g = GAB.aDrivers([{ id: 'A', tarjetas: [{ modelo: 'RARA' }] }]);
  assert.ok(g.avisos.length === 1);
});
test('gabinetes + drivers manuales se suman (únicos incluidos)', () => {
  const r = motor.calcular({ tipo: 'TRABAJO_MENOR', sitio: { incluir: false }, gabinetes: [{ id: 'A', tipo: 'MARSHALLING', io: { AI: 8 } }], drivers: { gabinetes: { total: 2, unicos: 1 } } });
  assert.deepStrictEqual(r.drivers.gabinetes, { total: 3, unicos: 2 });
});

console.log('Turnos');
test('turno 7x7 con relevo: 12 h/día, viaje cada 7 días trabajados, descanso = días trabajados, calendario = días trabajados', () => {
  const e = motor.deepMerge(ejemplo('planta-nueva.json'), { sitio: { turnos: { porDefecto: '7x7' }, fases: { PRECOM: { personas: 2 } } } });
  const r = motor.calcular(e);
  const f = r.sitio.fases.find(x => x.fase === 'PRECOM');
  assert.strictEqual(f.horasDia, 12); assert.strictEqual(f.diasCalendario, f.dias); assert.strictEqual(f.personasTotales, 4);
  casi(f.diasDescanso, f.personas * f.dias, 0.01);
  assert.strictEqual(r.sitio.viajesPorPuesto[0].viajes, Math.ceil(r.sitio.viajesPorPuesto[0].dias / 7));
});
test('turno 4x3 sin relevo estira el calendario en 7/4', () => {
  const e = motor.deepMerge(ejemplo('planta-nueva.json'), { sitio: { turnos: { porDefecto: '4x3' } } });
  const f = motor.calcular(e).sitio.fases.find(x => x.fase === 'MONTAJE');
  assert.strictEqual(f.diasCalendario, Math.ceil(f.dias * 7 / 4)); assert.strictEqual(f.personasTotales, f.personas);
});
test('turno por fase y descanso facturado opcional', () => {
  const e = motor.deepMerge(ejemplo('planta-nueva.json'), { sitio: { turnos: { porDefecto: '4x3', PRECOM: '7x7' } }, parametros: { turnos: { '7x7': { horasPorDiaDescanso: 8 } } } });
  const r = motor.calcular(e);
  assert.strictEqual(r.sitio.fases.find(x => x.fase === 'PRECOM').turno, '7x7');
  assert.strictEqual(r.sitio.fases.find(x => x.fase === 'SAT').turno, '4x3');
  assert.ok(r.actividades.find(a => a.id === 'SIT_DESCANSO_PRECOM').horas > 0);
  casi(motor.serviciosSitio(r).total, r.horas.porLugar.SITIO, 1.0);
});
test('modoLoopCheck por defecto: APOYA en planta nueva, EJECUTA en trabajo menor, sobreescribible', () => {
  assert.strictEqual(motor.calcular({ tipo: 'PLANTA_NUEVA', drivers: { io_AI: 10 } }).factores.modoLoopCheck.seleccion, 'APOYA');
  assert.strictEqual(motor.calcular({ tipo: 'TRABAJO_MENOR', drivers: { io_afectado: 10 } }).factores.modoLoopCheck.seleccion, 'EJECUTA');
  assert.strictEqual(motor.calcular({ tipo: 'PLANTA_NUEVA', factores: { modoLoopCheck: 'EJECUTA' }, drivers: { io_AI: 10 } }).factores.modoLoopCheck.seleccion, 'EJECUTA');
});
test('modoLoopCheck APOYA reduce lazos alambrados pero no la integración de equipos en red', () => {
  const d = { io_AI: 100, io_PROFIBUS: 20, interfaces_terceros: 4 };
  const a = motor.calcular({ tipo: 'PLANTA_NUEVA', factores: { modoLoopCheck: 'APOYA' }, drivers: d });
  const b = motor.calcular({ tipo: 'PLANTA_NUEVA', factores: { modoLoopCheck: 'EJECUTA' }, drivers: d });
  const h = (r, id) => r.actividades.find(x => x.id === id).horas;
  assert.ok(h(a, 'SIT_PRECOM_LAZOS') < h(b, 'SIT_PRECOM_LAZOS') * 0.35);
  casi(h(a, 'SIT_PRECOM_REDES'), h(b, 'SIT_PRECOM_REDES'), 0.01);
});
test('líder técnico no se suma en fases con una sola persona', () => {
  const r = motor.calcular({ tipo: 'PLANTA_NUEVA', drivers: { dias_pem: 20, io_AI: 10 }, sitio: { fases: { PRECOM: { personas: 1 } } } });
  assert.ok(r.sitio.fasesSinLider.includes('PEM'));
  assert.strictEqual(r.sitio.fases.find(f => f.fase === 'PEM').horasLider, 0);
  const r2 = motor.calcular({ tipo: 'PLANTA_NUEVA', drivers: { dias_pem: 20, io_AI: 10 }, parametros: { movilizacion: { liderSoloConCuadrilla: false } } });
  assert.ok(r2.sitio.fases.find(f => f.fase === 'PEM').horasLider > 0);
});
test('turno desconocido lanza error', () => { assert.throws(() => motor.calcular({ tipo: 'PLANTA_NUEVA', drivers: { io_AI: 100 }, sitio: { turnos: { porDefecto: '9x9' } } })); });

console.log('Servicios de sitio');
test('serviciosSitio reparte todo el sitio en 5 servicios sin perder horas', () => {
  const r = motor.calcular(ejemplo('planta-nueva.json'));
  const sv = motor.serviciosSitio(r);
  casi(sv.total, r.horas.porLugar.SITIO, 1.0);
  assert.ok(sv.servicios.every(o => ['SUPERVISION_MONTAJE', 'PRECOM', 'COM', 'SAT', 'PEM'].includes(o.servicio)));
  casi(sv.servicios.reduce((a, o) => a + o.horasLider, 0), r.sitio.horasLider, 1.0);
  casi(sv.servicios.reduce((a, o) => a + o.viajes, 0), r.sitio.viajes, 0.6);
});
test('serviciosSitio en trabajo menor unificado también cuadra', () => {
  const r = motor.calcular(ejemplo('menor-reemplazo.json'));
  casi(motor.serviciosSitio(r).total, r.horas.porLugar.SITIO, 0.5);
});

console.log('Costo y optimización');
test('costear: total = horas + viáticos + viajes + contingencia', () => {
  const e = ejemplo('planta-nueva.json'); const r = motor.calcular(e); const c = motor.costear(r, e.tarifas);
  casi(c.subtotal, c.horas + c.viaticos + c.viajes, 0.05); casi(c.total, c.subtotal * (1 + r.contingencia.porcentaje), 0.05);
  assert.strictEqual(c.avisos.length, 0);
});
test('optimizarCuadrillas no empeora el costo y devuelve personas por fase', () => {
  const e = ejemplo('planta-nueva.json');
  const base = motor.costear(motor.calcular(e), e.tarifas).total;
  const opt = motor.optimizarCuadrillas(e, e.tarifas);
  assert.ok(opt.costo.total <= base + 0.01, `${opt.costo.total} <= ${base}`);
  assert.ok(Object.keys(opt.personasPorFase).length > 0);
});

console.log('Compatibilidad navegador (sin module/require)');
test('los módulos se cargan en orden y exponen globalThis.DeltaVCosteo.motor', () => {
  const ctx = vm.createContext({ console });
  ['parametros', 'catalogo', 'plantillas', 'gabinetes', 'motor'].forEach(n => {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', n + '.js'), 'utf8'), ctx, { filename: n + '.js' });
  });
  const res = vm.runInContext('DeltaVCosteo.motor.calcular({ tipo: "TRABAJO_MENOR", drivers: { graficos_mod_S: 2 } }).horas.total', ctx);
  assert.ok(res > 0);
});

console.log(`\n${pasadas} pruebas OK`);
