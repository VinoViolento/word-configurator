/**
 * motor.js — Motor de cálculo del modelo de costeo de horas DeltaV.
 *
 * Uso (Node):
 *   const { calcular, costear, optimizarCuadrillas, reporteTexto } = require('./costing/motor.js');
 *   const r = calcular(entrada);
 *
 * Uso (navegador / add-in): cargar parametros.js, catalogo.js, plantillas.js, gabinetes.js, motor.js
 *   y usar window.DeltaVCosteo.motor.calcular(entrada).
 *
 * Ver docs/modelo-costeo-horas.md para la formulación completa.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./parametros.js'), require('./catalogo.js'), require('./plantillas.js'), require('./gabinetes.js'));
  } else {
    root.DeltaVCosteo = root.DeltaVCosteo || {};
    root.DeltaVCosteo.motor = factory(root.DeltaVCosteo.parametros, root.DeltaVCosteo.catalogo, root.DeltaVCosteo.plantillas, root.DeltaVCosteo.gabinetes);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (PARAMETROS, CATALOGO, PLANTILLAS, GABINETES) {
  'use strict';

  // ───────────────────────── utilidades ─────────────────────────
  const esObjeto = (x) => x && typeof x === 'object' && !Array.isArray(x);

  function deepMerge(base, extra) {
    if (!esObjeto(extra)) return extra === undefined ? base : extra;
    const out = Object.assign({}, base);
    Object.keys(extra).forEach(k => {
      out[k] = esObjeto(base && base[k]) && esObjeto(extra[k]) ? deepMerge(base[k], extra[k]) : extra[k];
    });
    return out;
  }
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const r1 = (x) => Math.round(x * 10) / 10;
  const r2 = (x) => Math.round(x * 100) / 100;

  /**
   * Estimado de tres puntos (PERT). Acepta número, [o,m,p] o {o,m,p}.
   * Para un número aplica el rango relativo del lugar.
   * @returns {{moda:number, media:number, sigma:number}}
   */
  function pert(v, lugar, params) {
    if (v == null) return { moda: 0, media: 0, sigma: 0 };
    let o, m, p;
    if (typeof v === 'number') {
      const rr = (params.incertidumbre.rangoRelativo[lugar] || params.incertidumbre.rangoRelativo.OFICINA);
      m = v; o = v * (1 + rr[0]); p = v * (1 + rr[1]);
    } else if (Array.isArray(v)) { [o, m, p] = v; }
    else { o = v.o; m = v.m; p = v.p; }
    return { moda: m, media: (o + 4 * m + p) / 6, sigma: Math.abs(p - o) / 6 };
  }

  /**
   * Cantidad efectiva con similitud y aprendizaje:
   *   n_ef = k^(1-b) + rho·(n-k),  b = -log2(LR)
   * @param n total, k únicos, rho costo relativo del clon, LR tasa de aprendizaje
   */
  function cantidadEfectiva(n, k, rho, LR) {
    if (n <= 0) return 0;
    k = clamp(k, Math.min(1, n), n);
    const b = -Math.log2(LR);
    return Math.pow(k, 1 - b) + rho * (n - k);
  }

  // ───────────────────────── drivers ─────────────────────────
  function normalizarDriver(v) {
    if (v == null) return { n: 0, k: undefined };
    if (typeof v === 'number') return { n: v, k: undefined };
    if (typeof v === 'object') return { n: v.total || 0, k: v.unicos == null ? undefined : v.unicos };
    throw new Error('Driver inválido: ' + JSON.stringify(v));
  }

  function sumarDrivers(destino, origen) {
    Object.keys(origen || {}).forEach(id => {
      const a = destino[id] || { n: 0, k: undefined };
      const b = normalizarDriver(origen[id]);
      const k = (a.k == null && b.k == null) ? undefined : (a.k == null ? a.n : a.k) + (b.k == null ? b.n : b.k);
      destino[id] = { n: a.n + b.n, k };
    });
  }

  function construirDrivers(entrada, plantilla, avisos) {
    const drivers = {};
    Object.keys(CATALOGO.DRIVERS).forEach(id => { drivers[id] = { n: 0, k: undefined }; });

    let detalleGabinetes = null;
    if (entrada.gabinetes && entrada.gabinetes.length) {
      const g = GABINETES.aDrivers(entrada.gabinetes, entrada.opcionesGabinetes);
      sumarDrivers(drivers, g.drivers);
      detalleGabinetes = g.detalle;
      avisos.push(...g.avisos);
    }
    let overridesAlcance = {}, sinSitioAlcance = false;
    if (entrada.alcance && entrada.alcance.length) {
      const a = PLANTILLAS.alcanceADrivers(entrada.alcance);
      sumarDrivers(drivers, a.drivers);
      overridesAlcance = a.overrides;
      sinSitioAlcance = !!a.sinSitio;
      avisos.push(...a.avisos);
    }
    Object.keys(entrada.drivers || {}).forEach(id => {
      if (!CATALOGO.DRIVERS[id]) avisos.push(`Driver "${id}" no está en el catálogo; se acepta pero ninguna actividad lo usa salvo que se agregue al catálogo.`);
    });
    sumarDrivers(drivers, entrada.drivers || {});

    // Valores por defecto de la plantilla cuando el usuario no los informa
    const informado = (id) => (entrada.drivers && entrada.drivers[id] != null);
    if (!informado('documentos_entregables') && drivers.documentos_entregables.n === 0) drivers.documentos_entregables.n = plantilla.documentosEntregablesPorDefecto || 0;
    if (!informado('dias_pem') && drivers.dias_pem.n === 0 && (!entrada.alcance || !entrada.alcance.length)) drivers.dias_pem.n = plantilla.diasPemPorDefecto || 0;

    // Derivados
    const plano = {};
    Object.keys(drivers).forEach(id => { plano[id] = drivers[id].n; });
    Object.keys(CATALOGO.DRIVERS_DERIVADOS).forEach(id => {
      plano[id] = CATALOGO.DRIVERS_DERIVADOS[id](plano);
      drivers[id] = { n: plano[id], k: undefined };
    });
    Object.keys(drivers).forEach(id => { if (drivers[id].n < 0) throw new Error(`Driver "${id}" negativo`); });
    return { drivers, detalleGabinetes, overridesAlcance, sinSitioAlcance };
  }

  // ───────────────────────── factores ─────────────────────────
  function resolverFactores(entrada, tipo, params, avisos) {
    const f = entrada.factores || {};
    const val = {};
    const tabla = params.factores;
    const elegir = (clave, defecto) => {
      const sel = f[clave] || defecto;
      if (tabla[clave][sel] == null) { avisos.push(`Factor ${clave}="${sel}" desconocido; se usa ${defecto}`); return { sel: defecto, v: tabla[clave][defecto] }; }
      return { sel, v: tabla[clave][sel] };
    };
    val.complejidad = elegir('complejidad', 'MEDIA');
    val.nivelDocumentacion = elegir('nivelDocumentacion', 'ESTANDAR');
    val.libreriaTipicos = elegir('libreriaTipicos', 'SIN');
    val.condicionesSitio = elegir('condicionesSitio', 'NORMAL');
    ['reusoSoftware', 'reusoHardware', 'brownfield'].forEach(k => {
      val[k] = { sel: tipo, v: f[k] != null && typeof f[k] === 'number' ? f[k] : tabla[k][tipo] };
    });
    return val;
  }

  // ───────────────────────── actividades ─────────────────────────
  function seleccionarActividades(entrada, tipo, plantilla, overridesAlcance, sinSitioAlcance, avisos) {
    const cfg = entrada.actividades || {};
    const excluir = new Set([...(plantilla.excluir || []), ...(cfg.excluir || [])]);
    const incluir = new Set(cfg.incluir || []);
    const sinSitio = (entrada.sitio && entrada.sitio.incluir === false) || (sinSitioAlcance && !(entrada.sitio && entrada.sitio.incluir === true));
    const lista = [];
    CATALOGO.ACTIVIDADES.forEach(def => {
      let a = Object.assign({}, def);
      const ov = Object.assign({}, (plantilla.overrides || {})[a.id], overridesAlcance[a.id], (cfg.overrides || {})[a.id]);
      a = deepMerge(a, ov);
      if (ov.terminos) a.terminos = ov.terminos; // reemplazo completo, no merge
      const aplicaTipo = !a.plantillas || a.plantillas.includes('*') || a.plantillas.includes(tipo);
      let activa = (aplicaTipo || incluir.has(a.id)) && !excluir.has(a.id) && !a.excluir;
      if (sinSitio && a.lugar === 'SITIO') activa = false;
      if (!a.lugar || !CATALOGO.LUGARES.includes(a.lugar)) { avisos.push(`Actividad ${a.id} con lugar inválido`); activa = false; }
      a.activa = activa;
      lista.push(a);
    });
    return lista;
  }

  function evaluarDirecta(a, ctx) {
    const { drivers, params, factores, tipo } = ctx;
    const terminos = [];
    let sumModa = 0, sumMedia = 0, sumVar = 0;
    (a.terminos || []).forEach(t => {
      if (t.plantillas && !t.plantillas.includes(tipo)) return;
      if (t.siCero && drivers[t.siCero] && drivers[t.siCero].n > 0) return;
      const drv = drivers[t.driver];
      if (!drv) { ctx.avisos.push(`Actividad ${a.id}: driver "${t.driver}" desconocido`); return; }
      const n = drv.n;
      if (n <= 0) return;
      let k = drv.k, nef = n, rho = null, phi = null;
      if (t.clon != null && t.clon !== false) {
        rho = t.clon === true ? params.similitud.rhoPorDefecto : t.clon;
        if (k == null) {
          const tablaPhi = (params.similitud.phi[tipo] || {});
          phi = t.phi && tablaPhi[t.phi] != null ? tablaPhi[t.phi] : params.similitud.phiPorDefecto;
          k = Math.ceil(phi * n);
        }
        k = clamp(k, 1, n);
        nef = cantidadEfectiva(n, k, rho, params.similitud.LR);
      }
      const u = pert(t.unitario, a.lugar, params);
      terminos.push({ driver: t.driver, n, unicos: k, phi, rho, nEfectivo: r2(nef), unitario: u.moda, horas: r1(u.moda * nef) });
      sumModa += u.moda * nef; sumMedia += u.media * nef; sumVar += Math.pow(u.sigma * nef, 2);
    });
    let F = pert(a.fijo, a.lugar, params);
    if (a.fijoCondicional && sumModa === 0) F = { moda: 0, media: 0, sigma: 0 };
    const factoresAplicados = {};
    let mult = a.multiplicador || 1;
    (a.factores || []).forEach(k => { if (factores[k]) { factoresAplicados[k] = factores[k].v; mult *= factores[k].v; } });
    if (a.transferenciaFAT && ctx.coberturaFAT > 0) {
      const tf = 1 - params.transferenciaFAT.tau * ctx.coberturaFAT;
      factoresAplicados.transferenciaFAT = r2(tf); mult *= tf;
    }
    return {
      id: a.id, nombre: a.nombre, lugar: a.lugar, fase: a.fase, rol: a.rol, tipo: 'DIRECTA',
      fijo: F.moda, terminos, multiplicador: a.multiplicador || 1, factores: factoresAplicados, factorTotal: r2(mult),
      horas: (F.moda + sumModa) * mult,
      media: (F.media + sumMedia) * mult,
      sigma: Math.sqrt(F.sigma * F.sigma + sumVar) * mult
    };
  }

  function grupo(nombre, calculadas, a) {
    const lista = Object.values(calculadas).filter(x => x.id !== a.id);
    if (nombre === 'NO_SITIO') return lista.filter(x => x.lugar !== 'SITIO');
    if (CATALOGO.LUGARES.includes(nombre)) return lista.filter(x => x.lugar === nombre);
    if (nombre === 'TODAS') return lista;
    return lista.filter(x => (x.etiquetas || []).includes(nombre));
  }

  function evaluarPorcentaje(a, calculadas, ctx) {
    const d = a.derivada;
    const base = grupo(d.grupo, calculadas, a);
    const sumH = base.reduce((s, x) => s + x.horas, 0);
    const sumM = base.reduce((s, x) => s + x.media, 0);
    const sumV = base.reduce((s, x) => s + x.sigma * x.sigma, 0);
    const factoresAplicados = {};
    let mult = 1;
    (a.factores || []).forEach(k => { if (ctx.factores[k]) { factoresAplicados[k] = ctx.factores[k].v; mult *= ctx.factores[k].v; } });
    const F = pert(a.fijo, a.lugar, ctx.params);
    const fijo = (a.fijoCondicional && sumH === 0) ? 0 : F.moda;
    const porSemana = (d.porSemana || 0) * (ctx.semanas || 0);
    return {
      id: a.id, nombre: a.nombre, lugar: a.lugar, fase: a.fase, rol: a.rol, tipo: 'DERIVADA',
      fijo, derivadaDe: { grupo: d.grupo, porcentaje: d.porcentaje, baseHoras: r1(sumH), porSemana: d.porSemana || 0, semanas: ctx.semanas || 0 },
      factores: factoresAplicados, factorTotal: r2(mult),
      horas: (fijo + d.porcentaje * sumH + porSemana) * mult,
      media: ((a.fijoCondicional && sumH === 0 ? 0 : F.media) + d.porcentaje * sumM + porSemana) * mult,
      sigma: Math.sqrt(F.sigma * F.sigma + d.porcentaje * d.porcentaje * sumV) * mult
    };
  }

  // ───────────────────────── calendario de sitio ─────────────────────────
  /**
   * Dimensiona la cuadrilla de una fase: parte de `minimo` y crece hasta cumplir `diasObjetivo`
   * (o hasta `maximo`). Devuelve { personas, eficiencia, dias }.
   */
  function dimensionarCuadrilla(H, minimo, maximo, diasObjetivo, h, kappa, effMin, forzado) {
    const evaluar = (c) => {
      const eff = Math.max(effMin, 1 - kappa * (c - 1));
      return { personas: c, eficiencia: r2(eff), dias: Math.ceil(H / (c * h * eff)) };
    };
    if (forzado != null) return evaluar(clamp(Math.round(forzado), 1, maximo));
    let c = clamp(Math.round(minimo), 1, maximo);
    let r = evaluar(c);
    while (diasObjetivo && r.dias > diasObjetivo && c < maximo) { c += 1; r = evaluar(c); }
    return r;
  }

  function calendarioSitio(actividades, calculadas, entrada, plantilla, params) {
    const h = params.jornada.horasDiaSitio;
    const kappa = params.cuadrillas.kappa, effMin = params.cuadrillas.eficienciaMinima, cMax = params.cuadrillas.personasMaximas;
    const sit = entrada.sitio || {};
    const R = sit.rotacionDias || params.movilizacion.rotacionDias;
    const hViaje = sit.horasViajeIda != null ? sit.horasViajeIda : params.movilizacion.horasViajeIda;
    const dViaje = params.movilizacion.diasViajePorViaje;
    const presencia = sit.presenciaLider != null ? sit.presenciaLider : (plantilla.presenciaLider != null ? plantilla.presenciaLider : params.movilizacion.presenciaLider);
    const overridesFases = sit.fases || {};

    // Definición de fases: por plantilla, o unificadas en una sola cuadrilla (trabajos menores)
    let defs = plantilla.fasesSitio;
    const unificado = sit.calendarioUnificado != null ? sit.calendarioUnificado : plantilla.calendarioUnificado;
    if (unificado) {
      const fasesPresentes = plantilla.fasesSitio.map(f => f.fase);
      defs = [Object.assign({ fase: 'SITIO', solape: 0, personas: 1, diasObjetivo: 10 }, unificado, { agrupa: fasesPresentes })];
    }

    const fases = [];
    let diasCal = 0, diasPersona = 0, prevDias = 0;
    const perfil = []; // perfil de dotación: [{personas, dias}] para contar viajes por persona
    defs.forEach(fd => {
      const ov = overridesFases[fd.fase] || {};
      const acts = Object.values(calculadas).filter(x => x.lugar === 'SITIO' && x.tipo === 'DIRECTA' && (fd.agrupa ? fd.agrupa.includes(x.fase) : x.fase === fd.fase));
      const H = acts.reduce((s, x) => s + x.horas, 0);
      if (H <= 0) return;
      let forzado = ov.personas;
      if (fd.fase === 'PEM' && sit.personasPem) forzado = sit.personasPem;
      const dim = dimensionarCuadrilla(H, fd.personas, cMax, ov.diasObjetivo != null ? ov.diasObjetivo : fd.diasObjetivo, h, kappa, effMin, forzado);
      const { personas: c, eficiencia: eff, dias } = dim;
      const horasCalendario = c * h * dias;
      const solape = ov.solape != null ? ov.solape : (fd.solape || 0);
      diasCal += dias - Math.min(dias, prevDias) * solape;
      diasPersona += c * dias;
      perfil.push({ personas: c, dias });
      fases.push({ fase: fd.fase, agrupa: fd.agrupa, actividades: acts.map(x => x.id), horasModelo: r1(H), personas: c, eficiencia: eff, dias, horasCalendario, ajuste: r1(horasCalendario - H), solape });
      prevDias = dias;
      // Fila de ajuste: la cuadrilla está jornadas completas aunque el modelo dé horas fraccionarias
      const ajuste = horasCalendario - H;
      if (ajuste > 0.05) {
        const id = 'SIT_AJUSTE_' + fd.fase;
        calculadas[id] = { id, nombre: `Ajuste a jornadas completas (${fd.fase}: ${c} pers. × ${dias} d × ${h} h)`, lugar: 'SITIO', fase: fd.fase, rol: acts[0].rol, tipo: 'AJUSTE', horas: ajuste, media: ajuste, sigma: 0, factores: {}, factorTotal: 1, etiquetas: [] };
      }
    });
    diasCal = Math.ceil(diasCal);
    const diasLider = Math.ceil(diasCal * presencia);

    // Viajes por "puesto" de cuadrilla: el puesto i viaja en todas las fases con >= i personas (la misma
    // persona encadena fases consecutivas), rotando cada R días.
    const maxC = perfil.reduce((m, p) => Math.max(m, p.personas), 0);
    let viajes = 0;
    const viajesPorPuesto = [];
    for (let i = 1; i <= maxC; i++) {
      const dias = perfil.filter(p => p.personas >= i).reduce((s, p) => s + p.dias, 0);
      const v = Math.ceil(dias / R); viajes += v; viajesPorPuesto.push({ puesto: i, dias, viajes: v });
    }
    const viajesLider = diasLider > 0 ? Math.ceil(diasLider / R) : 0;
    viajes += viajesLider;
    diasPersona += diasLider;
    return {
      fases, diasCalendario: diasCal, diasLider, horasLider: diasLider * h, presenciaLider: presencia,
      viajes, viajesPorPuesto, viajesLider, horasViaje: viajes * 2 * hViaje,
      diasViatico: diasPersona + viajes * dViaje, rotacionDias: R, horasDia: h, unificado: !!unificado
    };
  }

  // ───────────────────────── cálculo principal ─────────────────────────
  /**
   * @param {object} entrada  ver docs §3 (tipo, drivers, gabinetes, alcance, factores, sitio, actividades, parametros, proyecto)
   * @returns {object} resultado
   */
  function calcular(entrada) {
    entrada = entrada || {};
    const avisos = [];
    const params = deepMerge(PARAMETROS, entrada.parametros || {});
    const tipo = entrada.tipo || 'PLANTA_NUEVA';
    const plantilla = PLANTILLAS.PLANTILLAS[tipo];
    if (!plantilla) throw new Error(`Tipo de proyecto desconocido: ${tipo}. Use ${Object.keys(PLANTILLAS.PLANTILLAS).join(', ')}`);

    const { drivers, detalleGabinetes, overridesAlcance, sinSitioAlcance } = construirDrivers(entrada, plantilla, avisos);
    const factores = resolverFactores(entrada, tipo, params, avisos);
    const coberturaFAT = (entrada.sitio && entrada.sitio.coberturaFAT != null) ? entrada.sitio.coberturaFAT : params.transferenciaFAT.coberturaPorDefecto[tipo];
    const actividades = seleccionarActividades(entrada, tipo, plantilla, overridesAlcance, sinSitioAlcance, avisos);
    const ctx = { drivers, params, factores, tipo, coberturaFAT, avisos, semanas: 0 };
    const calculadas = {};

    // 1) directas
    actividades.filter(a => a.activa && !a.derivada).forEach(a => {
      const r = evaluarDirecta(a, ctx); r.etiquetas = a.etiquetas || []; calculadas[a.id] = r;
    });
    // 2) derivadas orden 1 (porcentajes sobre grupos de directas)
    const derivadas = actividades.filter(a => a.activa && a.derivada).sort((x, y) => (x.derivada.orden || 1) - (y.derivada.orden || 1));
    derivadas.filter(a => (a.derivada.orden || 1) === 1).forEach(a => { const r = evaluarPorcentaje(a, calculadas, ctx); r.etiquetas = a.etiquetas || []; calculadas[a.id] = r; });

    // 3) calendario de sitio y derivadas de calendario (orden 2)
    const sitio = calendarioSitio(actividades, calculadas, entrada, plantilla, params);
    derivadas.filter(a => a.derivada.calendario).forEach(a => {
      let horas = 0, nombre = a.nombre;
      if (a.derivada.calendario === 'liderTecnico') horas = sitio.horasLider;
      if (a.derivada.calendario === 'movilizacion') horas = sitio.horasViaje;
      if (horas <= 0) return;
      const s = pert(horas, 'SITIO', params);
      calculadas[a.id] = { id: a.id, nombre, lugar: a.lugar, fase: a.fase, rol: a.rol, tipo: 'CALENDARIO', horas: s.moda, media: s.media, sigma: s.sigma, factores: {}, factorTotal: 1, etiquetas: a.etiquetas || [] };
    });

    // 4) duración estimada y derivadas orden 3 (gestión, calidad)
    const horasNoSitio = Object.values(calculadas).filter(x => x.lugar !== 'SITIO').reduce((s, x) => s + x.horas, 0);
    const equipo = clamp(Math.round(horasNoSitio / params.jornada.horasPorIngenieroEquipo), 1, params.jornada.equipoMaximo);
    const semanasOficina = horasNoSitio > 0 ? Math.ceil(horasNoSitio / (equipo * params.jornada.horasSemanaEfectivas)) : 0;
    const semanasSitio = sitio.diasCalendario / params.jornada.diasSemana;
    ctx.semanas = entrada.duracionSemanas != null ? entrada.duracionSemanas : Math.ceil(semanasOficina + params.duracion.porcentajeSitioEnDuracion * semanasSitio);
    derivadas.filter(a => (a.derivada.orden || 1) >= 3 && !a.derivada.calendario).forEach(a => { const r = evaluarPorcentaje(a, calculadas, ctx); r.etiquetas = a.etiquetas || []; calculadas[a.id] = r; });

    // 5) agregaciones
    const lista = Object.values(calculadas).filter(x => x.horas > 0.0001);
    const agrupar = (clave) => lista.reduce((acc, x) => { acc[x[clave]] = r1((acc[x[clave]] || 0) + x.horas); return acc; }, {});
    const porLugar = agrupar('lugar'); CATALOGO.LUGARES.forEach(l => { porLugar[l] = porLugar[l] || 0; });
    const total = lista.reduce((s, x) => s + x.horas, 0);
    const media = lista.reduce((s, x) => s + x.media, 0);
    const sumSig2 = lista.reduce((s, x) => s + x.sigma * x.sigma, 0);
    const sumSig = lista.reduce((s, x) => s + x.sigma, 0);
    const rho = params.incertidumbre.correlacion;
    const sigma = Math.sqrt((1 - rho) * sumSig2 + rho * sumSig * sumSig);
    const z = params.incertidumbre.z;

    const emisionRaw = (entrada.proyecto && entrada.proyecto.emision) || 'PRESUPUESTARIA';
    const emision = params.contingencia.alias[emisionRaw] || emisionRaw;
    const pctCont = params.contingencia[emision] != null ? params.contingencia[emision] : params.contingencia.PRESUPUESTARIA;

    const driversPlanos = {};
    Object.keys(drivers).forEach(id => { if (drivers[id].n) driversPlanos[id] = drivers[id].k == null ? drivers[id].n : { total: drivers[id].n, unicos: drivers[id].k }; });

    return {
      version: params.version,
      proyecto: entrada.proyecto || {},
      tipo, plantilla: plantilla.nombre,
      factores: Object.fromEntries(Object.entries(factores).map(([k, v]) => [k, { seleccion: v.sel, valor: v.v }])),
      coberturaFAT,
      drivers: driversPlanos,
      gabinetes: detalleGabinetes,
      actividades: lista.map(x => Object.assign({}, x, { horas: r1(x.horas), media: r1(x.media), sigma: r1(x.sigma) })).sort((a, b) => a.lugar.localeCompare(b.lugar) || a.fase.localeCompare(b.fase)),
      actividadesInactivas: actividades.filter(a => !a.activa).map(a => a.id),
      horas: {
        total: r1(total),
        noSitio: r1((porLugar.OFICINA || 0) + (porLugar.TALLER || 0)),
        porLugar, porFase: agrupar('fase'), porRol: agrupar('rol')
      },
      sitio,
      duracion: { equipoOficina: equipo, semanasOficina, semanasSitio: r1(semanasSitio), semanasTotales: ctx.semanas },
      incertidumbre: {
        media: r1(media), sigma: r1(sigma), coefVariacion: total > 0 ? r2(sigma / total) : 0,
        P80: r1(media + z.P80 * sigma), P90: r1(media + z.P90 * sigma), correlacion: rho
      },
      contingencia: { emision, porcentaje: pctCont, horas: r1(total * pctCont), totalConContingencia: r1(total * (1 + pctCont)) },
      avisos
    };
  }

  // ───────────────────────── costo ─────────────────────────
  /**
   * Convierte horas en costo. tarifas: { GP: 90, LI: 85, IS: 70, ..., viatico: 120, viaje: 900, moneda: 'USD' }
   * Roles sin tarifa usan `tarifas.defecto` (o 0 con aviso).
   */
  function costear(resultado, tarifas) {
    tarifas = tarifas || {};
    const avisos = [];
    const porRol = {};
    let horasCosto = 0;
    Object.keys(resultado.horas.porRol).forEach(rol => {
      let t = tarifas[rol];
      if (t == null) { t = tarifas.defecto || 0; if (!tarifas.defecto) avisos.push(`Sin tarifa para rol ${rol}`); }
      porRol[rol] = { horas: resultado.horas.porRol[rol], tarifa: t, costo: r2(resultado.horas.porRol[rol] * t) };
      horasCosto += porRol[rol].costo;
    });
    const viaticos = r2((resultado.sitio.diasViatico || 0) * (tarifas.viatico || 0));
    const viajes = r2((resultado.sitio.viajes || 0) * (tarifas.viaje || 0));
    const subtotal = r2(horasCosto + viaticos + viajes);
    const contingencia = r2(subtotal * resultado.contingencia.porcentaje);
    return { moneda: tarifas.moneda || '', porRol, horas: r2(horasCosto), viaticos, viajes, subtotal, contingencia, total: r2(subtotal + contingencia), avisos };
  }

  // ───────────────────────── optimización de cuadrillas ─────────────────────────
  /**
   * Busca, fase por fase, el tamaño de cuadrilla que minimiza el costo total
   * (horas × tarifa + viáticos + viajes). Sin tarifas minimiza horas totales de sitio.
   * @returns {{ personasPorFase: object, resultado: object, costo: object|null, evaluaciones: Array }}
   */
  function optimizarCuadrillas(entrada, tarifas, opciones) {
    opciones = opciones || {};
    const max = opciones.personasMaximas || 6;
    const objetivo = (ent) => {
      const r = calcular(ent);
      const c = tarifas ? costear(r, tarifas) : null;
      return { r, c, valor: c ? c.total : r.horas.porLugar.SITIO };
    };
    let ent = deepMerge(entrada, { sitio: { fases: {} } });
    const base = objetivo(ent);
    const evaluaciones = [];
    const personasPorFase = {};
    base.r.sitio.fases.forEach(f => {
      let mejor = { personas: f.personas, valor: Infinity };
      for (let c = 1; c <= max; c++) {
        const e2 = deepMerge(ent, { sitio: { fases: { [f.fase]: { personas: c } } } });
        const o = objetivo(e2);
        evaluaciones.push({ fase: f.fase, personas: c, valor: r2(o.valor), diasCalendario: o.r.sitio.diasCalendario });
        if (o.valor < mejor.valor - 1e-9) mejor = { personas: c, valor: o.valor };
      }
      personasPorFase[f.fase] = mejor.personas;
      ent = deepMerge(ent, { sitio: { fases: { [f.fase]: { personas: mejor.personas } } } });
    });
    const fin = objetivo(ent);
    return { personasPorFase, resultado: fin.r, costo: fin.c, evaluaciones, entradaOptimizada: ent };
  }

  // ───────────────────────── reporte ─────────────────────────
  function reporteTexto(r, costo) {
    const L = [];
    const pad = (s, n) => String(s).padEnd(n);
    const num = (x, n) => String(x).padStart(n);
    L.push(`MODELO DE HORAS DELTAV v${r.version} — ${r.proyecto.nombre || '(sin nombre)'} — ${r.plantilla}`);
    L.push(`Factores: ${Object.entries(r.factores).map(([k, v]) => `${k}=${v.seleccion}(${v.valor})`).join(', ')}; coberturaFAT=${r.coberturaFAT}`);
    L.push('');
    L.push('DRIVERS: ' + Object.entries(r.drivers).map(([k, v]) => `${k}=${typeof v === 'number' ? v : v.total + '/' + v.unicos + 'u'}`).join(', '));
    L.push('');
    L.push(pad('ACTIVIDAD', 32) + pad('LUGAR', 9) + pad('FASE', 16) + pad('ROL', 5) + num('HORAS', 9) + num('σ', 7) + '  DETALLE');
    r.actividades.forEach(a => {
      const det = a.tipo === 'DIRECTA'
        ? [a.fijo ? `fijo ${a.fijo}` : null, ...a.terminos.map(t => `${t.driver} ${t.unicos != null ? t.n + '→' + t.nEfectivo : t.n}×${t.unitario}`), a.factorTotal !== 1 ? `×${a.factorTotal}` : null].filter(Boolean).join(' + ')
        : a.tipo === 'DERIVADA' ? `${a.derivadaDe.porcentaje * 100}% de ${a.derivadaDe.grupo} (${a.derivadaDe.baseHoras} h)${a.derivadaDe.porSemana ? ' + ' + a.derivadaDe.porSemana + ' h/sem × ' + a.derivadaDe.semanas : ''}${a.fijo ? ' + fijo ' + a.fijo : ''}`
          : '';
      L.push(pad(a.id, 32) + pad(a.lugar, 9) + pad(a.fase, 16) + pad(a.rol, 5) + num(a.horas, 9) + num(a.sigma, 7) + '  ' + det);
    });
    L.push('');
    L.push(`HORAS POR LUGAR : ${Object.entries(r.horas.porLugar).map(([k, v]) => `${k}=${v}`).join('  ')}   TOTAL=${r.horas.total}`);
    L.push(`HORAS POR ROL   : ${Object.entries(r.horas.porRol).map(([k, v]) => `${k}=${v}`).join('  ')}`);
    L.push(`HORAS POR FASE  : ${Object.entries(r.horas.porFase).map(([k, v]) => `${k}=${v}`).join('  ')}`);
    if (r.sitio.fases.length) {
      L.push('');
      L.push('SITIO: ' + r.sitio.fases.map(f => `${f.fase}: ${f.horasModelo} h → ${f.personas} pers × ${f.dias} d (ef ${f.eficiencia})`).join(' | '));
      L.push(`       días calendario=${r.sitio.diasCalendario}  líder=${r.sitio.diasLider} d (${r.sitio.horasLider} h)  viajes=${r.sitio.viajes} (${r.sitio.horasViaje} h)  días viático=${r.sitio.diasViatico}`);
    }
    L.push(`DURACIÓN: equipo oficina=${r.duracion.equipoOficina}  semanas oficina=${r.duracion.semanasOficina}  semanas sitio=${r.duracion.semanasSitio}  total=${r.duracion.semanasTotales}`);
    L.push(`INCERTIDUMBRE: media=${r.incertidumbre.media}  σ=${r.incertidumbre.sigma} (CV ${r.incertidumbre.coefVariacion})  P80=${r.incertidumbre.P80}  P90=${r.incertidumbre.P90}`);
    L.push(`CONTINGENCIA (${r.contingencia.emision} ${r.contingencia.porcentaje * 100}%): ${r.contingencia.horas} h → total ${r.contingencia.totalConContingencia} h`);
    if (costo) {
      L.push('');
      L.push(`COSTO ${costo.moneda}: horas=${costo.horas}  viáticos=${costo.viaticos}  viajes=${costo.viajes}  subtotal=${costo.subtotal}  contingencia=${costo.contingencia}  TOTAL=${costo.total}`);
    }
    if (r.avisos.length) { L.push(''); L.push('AVISOS:'); r.avisos.forEach(a => L.push('  - ' + a)); }
    return L.join('\n');
  }

  return { calcular, costear, optimizarCuadrillas, reporteTexto, pert, cantidadEfectiva, deepMerge, PARAMETROS, CATALOGO, PLANTILLAS, GABINETES };
});
