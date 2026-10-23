/**
 * plantillas.js — Plantillas por tipo de proyecto y mapeo de "alcance" a drivers.
 *
 * Una plantilla no cambia la matemática: sólo decide qué actividades se activan,
 * sobreescribe algunos fijos/porcentajes, define las fases de sitio con sus cuadrillas
 * y fija valores por defecto (phi, cobertura FAT, documentos entregables).
 *
 * Tipos de proyecto:
 *   PLANTA_NUEVA   sistema completo nuevo (greenfield)
 *   EXPANSION      ampliación de un DeltaV existente (nuevas E/S, unidades, gabinetes)
 *   MIGRACION      reemplazo de un DCS/PLC legado por DeltaV (conversión + cutover)
 *   TRABAJO_MENOR  servicios acotados: pantallas, lógica, gabinetes, integración, reemplazos, soporte
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DeltaVCosteo = root.DeltaVCosteo || {};
  root.DeltaVCosteo.plantillas = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Secuencia canónica de fases de sitio. `solape` = fracción de la fase que se superpone con la anterior. */
  /**
   *  personas     = cuadrilla mínima; diasObjetivo = duración máxima deseada de la fase.
   *  El motor agranda la cuadrilla (hasta parametros.cuadrillas.personasMaximas) hasta cumplir diasObjetivo.
   */
  const FASES_SITIO_BASE = [
    { fase: 'MONTAJE', personas: 1, solape: 0, diasObjetivo: 40 },
    { fase: 'SERVICIO', personas: 1, solape: 0, diasObjetivo: 10 },
    { fase: 'PRECOM', personas: 2, solape: 0.2, diasObjetivo: 30 },
    { fase: 'CUTOVER', personas: 2, solape: 0, diasObjetivo: 10 },
    { fase: 'COM', personas: 2, solape: 0.3, diasObjetivo: 30 },
    { fase: 'SAT', personas: 2, solape: 0, diasObjetivo: 30 },
    { fase: 'PEM', personas: 1, solape: 0, diasObjetivo: 60 },
    { fase: 'CAPACITACION', personas: 1, solape: 0.5, diasObjetivo: 10 }
  ];

  const PLANTILLAS = {
    PLANTA_NUEVA: {
      nombre: 'Planta nueva (greenfield)',
      descripcion: 'Ingeniería completa, fabricación de gabinetes, FAT, montaje, PRECOM, COM, SAT, PEM y capacitación.',
      excluir: ['SW_MOD_GRAFICOS', 'SW_MOD_LOGICA', 'SW_MIGRACION_BD', 'CUTOVER_PLANIFICACION', 'SIT_CUTOVER',
        'SIT_REEMPLAZO_COMPONENTES', 'SIT_DESPLIEGUE_MODIFICACIONES', 'TAL_INTEGRACION_MATERIALES'],
      overrides: {},
      fasesSitio: FASES_SITIO_BASE,
      presenciaLider: 1.0,
      documentosEntregablesPorDefecto: 14,
      diasPemPorDefecto: 10
    },
    EXPANSION: {
      nombre: 'Expansión de sistema existente',
      descripcion: 'Nuevas E/S, unidades o gabinetes sobre un DeltaV en operación. Reúso de típicos y estándares; cutover en ventana.',
      excluir: ['SW_MIGRACION_BD', 'SIT_REEMPLAZO_COMPONENTES'],
      overrides: {
        SW_SETUP_SISTEMA: { fijo: 8 },
        DOC_FDS: { fijo: 12 },
        ING_ARQUITECTURA: { fijo: 8 },
        DOC_MANUALES: { fijo: 8, nombre: 'Actualización de manuales de operación y mantenimiento' }
      },
      fasesSitio: FASES_SITIO_BASE,
      presenciaLider: 0.5,
      documentosEntregablesPorDefecto: 10,
      diasPemPorDefecto: 5
    },
    MIGRACION: {
      nombre: 'Migración de sistema legado a DeltaV',
      descripcion: 'Conversión de base de datos y gráficos, hardware nuevo, cutover por áreas en planta en operación.',
      excluir: ['SIT_REEMPLAZO_COMPONENTES', 'SW_MOD_GRAFICOS', 'SW_MOD_LOGICA'],
      overrides: {
        CUTOVER_PLANIFICACION: { fijo: 40 }
      },
      fasesSitio: FASES_SITIO_BASE,
      presenciaLider: 1.0,
      documentosEntregablesPorDefecto: 14,
      diasPemPorDefecto: 10
    },
    TRABAJO_MENOR: {
      nombre: 'Trabajo menor / servicio',
      descripcion: 'Modificación de pantallas o lógica, suministro de gabinetes, integración de materiales, reemplazo de componentes, soporte.',
      excluir: ['DOC_FDS', 'ING_ARQUITECTURA', 'DOC_MANUALES', 'PRU_FAT_PREPARACION', 'PRU_FAT_EJECUCION',
        'SW_MIGRACION_BD', 'CUTOVER_PLANIFICACION', 'SIT_CUTOVER'],
      overrides: {
        GP_GESTION: { derivada: { porcentaje: 0.08, grupo: 'NO_SITIO', porSemana: 2, orden: 3 } },
        GP_KICKOFF: { fijo: 4 },
        ING_REVISION_REQUISITOS: { fijo: 4 },
        SW_SETUP_SISTEMA: { fijo: 0 },
        DOC_HDS: { fijo: 4 },
        DOC_PROTOCOLOS: { fijo: 4 },
        DOC_CONTROL_DOCUMENTAL: { fijo: 2 },
        DOC_ASBUILT: { fijo: 2 },
        SOPORTE_GARANTIA: { fijo: 4 },
        SIT_SAT: { fijo: 4, multiplicador: 1 }
      },
      fasesSitio: FASES_SITIO_BASE.map(f => ({ ...f, personas: f.fase === 'PRECOM' || f.fase === 'COM' ? 2 : 1 })),
      // Una misma cuadrilla hace todo el trabajo de sitio de corrido (sin fases separadas en calendario).
      calendarioUnificado: { personas: 1, diasObjetivo: 10 },
      presenciaLider: 0,   // el ingeniero de comisionamiento actúa de líder
      documentosEntregablesPorDefecto: 3,
      diasPemPorDefecto: 0
    }
  };

  /**
   * Subtipos de trabajo menor: describen ítems de `alcance` y cómo se traducen a drivers.
   * Sirven de guía para la UI; el motor sólo entiende drivers.
   */
  const TIPOS_ALCANCE = {
    MOD_PANTALLA: {
      nombre: 'Modificación de pantallas',
      campos: { tamano: ['S', 'M', 'L'], cantidad: 'número', despliegue: ['REMOTO', 'SITIO', 'NINGUNO'] },
      mapear: (it, d) => { suma(d, 'graficos_mod_' + (it.tamano || 'M'), it.cantidad || 1); }
    },
    MOD_LOGICA: {
      nombre: 'Modificación de lógica / estrategias',
      campos: { complejidad: ['SIMPLE', 'MEDIA', 'COMPLEJA', 'SECUENCIA'], cantidad: 'número', despliegue: ['REMOTO', 'SITIO', 'NINGUNO'] },
      mapear: (it, d) => {
        const m = { SIMPLE: 'modulos_mod_simples', MEDIA: 'modulos_mod_medios', COMPLEJA: 'modulos_mod_complejos', SECUENCIA: 'fases_mod' };
        suma(d, m[it.complejidad || 'MEDIA'], it.cantidad || 1);
      }
    },
    NUEVO_IO: {
      nombre: 'Nuevas E/S (canales) y sus módulos',
      campos: { AI: 'n', AO: 'n', DI: 'n', DO: 'n', RTD_TC: 'n', HART: 'n', modulosSimples: 'n', modulosMedios: 'n', modulosComplejos: 'n', ioAfectado: 'n' },
      mapear: (it, d) => {
        ['AI', 'AO', 'DI', 'DO', 'RTD_TC', 'HART', 'FF', 'PROFIBUS'].forEach(k => suma(d, 'io_' + k, it[k] || 0));
        suma(d, 'modulos_simples', it.modulosSimples || 0);
        suma(d, 'modulos_medios', it.modulosMedios || 0);
        suma(d, 'modulos_complejos', it.modulosComplejos || 0);
        suma(d, 'alarmas', it.alarmas || 0);
      }
    },
    INTEGRACION_MATERIALES: {
      nombre: 'Integración de materiales en gabinete existente',
      campos: { componentes: 'n', terminaciones: 'n (si no, 4 por componente)', gabinetesAfectados: 'n' },
      mapear: (it, d) => {
        const comp = it.componentes || 0;
        suma(d, 'componentes_integrar', comp);
        suma(d, 'terminaciones_integrar', it.terminaciones != null ? it.terminaciones : comp * 4);
        suma(d, 'gabinetes_afectados', it.gabinetesAfectados || 1);
      }
    },
    REEMPLAZO_COMPONENTE: {
      nombre: 'Reemplazo de componentes (tarjetas, controladores, estaciones)',
      campos: { componente: ['TARJETA', 'CONTROLADOR', 'ESTACION'], cantidad: 'n', ioAfectado: 'n (si no, 8 por tarjeta)' },
      mapear: (it, d) => {
        const n = it.cantidad || 1;
        const m = { TARJETA: 'reemplazo_tarjetas', CONTROLADOR: 'reemplazo_controladores', ESTACION: 'reemplazo_estaciones' };
        suma(d, m[it.componente || 'TARJETA'], n);
        const ioAf = it.ioAfectado != null ? it.ioAfectado : (it.componente === 'TARJETA' || !it.componente ? n * 8 : 0);
        suma(d, 'io_afectado', ioAf);
      }
    },
    SUMINISTRO_GABINETE: {
      nombre: 'Suministro de gabinete(s) (sin lista detallada; use `gabinetes` para la salida de la herramienta de gabinetes)',
      campos: { cantidad: 'n', unicos: 'n', componentesPorGabinete: 'n', terminacionesPorGabinete: 'n', tarjetasPorGabinete: 'n' },
      mapear: (it, d) => {
        const n = it.cantidad || 1;
        sumaConUnicos(d, 'gabinetes', n, it.unicos);
        suma(d, 'componentes', n * (it.componentesPorGabinete || 60));
        suma(d, 'terminaciones', n * (it.terminacionesPorGabinete || 400));
        suma(d, 'tarjetas', n * (it.tarjetasPorGabinete || 0));
      }
    },
    SOPORTE_SITIO: {
      nombre: 'Soporte en sitio por días (PEM, asistencia técnica)',
      campos: { dias: 'n', personas: 'n' },
      mapear: (it, d) => { suma(d, 'dias_pem', (it.dias || 0) * (it.personas || 1)); }
    },
    SUPERVISION_MONTAJE: {
      nombre: 'Supervisión de montaje por días',
      campos: { dias: 'n' },
      mapear: (it, d) => { suma(d, 'dias_supervision_montaje', it.dias || 0); }
    },
    CAPACITACION: {
      nombre: 'Capacitación',
      campos: { cursos: 'n' },
      mapear: (it, d) => { suma(d, 'cursos_capacitacion', it.cursos || 1); }
    },
    DOCUMENTO: {
      nombre: 'Documento entregable adicional',
      campos: { cantidad: 'n' },
      mapear: (it, d) => { suma(d, 'documentos_entregables', it.cantidad || 1); }
    }
  };

  function suma(d, clave, valor) {
    if (!valor) return;
    const actual = d[clave];
    if (actual == null) d[clave] = valor;
    else if (typeof actual === 'number') d[clave] = actual + valor;
    else d[clave] = { total: (actual.total || 0) + valor, unicos: actual.unicos };
  }
  function sumaConUnicos(d, clave, total, unicos) {
    const actual = d[clave];
    const prevT = actual == null ? 0 : (typeof actual === 'number' ? actual : (actual.total || 0));
    const prevU = actual == null ? 0 : (typeof actual === 'number' ? actual : (actual.unicos == null ? actual.total : actual.unicos));
    d[clave] = { total: prevT + total, unicos: prevU + (unicos == null ? total : unicos) };
  }

  /**
   * Convierte una lista de ítems de alcance en drivers (sumados) y ajustes.
   * @returns {{ drivers: object, overrides: object, avisos: string[] }}
   */
  function alcanceADrivers(alcance) {
    const drivers = {};
    const overrides = {};
    const avisos = [];
    let sinSitio = false;
    let despliegues = [];
    (alcance || []).forEach((it, i) => {
      const def = TIPOS_ALCANCE[it.tipo];
      if (!def) { avisos.push(`Ítem de alcance #${i + 1}: tipo desconocido "${it.tipo}"`); return; }
      def.mapear(it, drivers);
      if (it.despliegue) despliegues.push(it.despliegue);
    });
    // Modificaciones desplegadas en remoto: la actividad de despliegue pasa a OFICINA (sin cuadrilla ni viajes).
    const soloModificaciones = (alcance || []).every(it => it.tipo === 'MOD_PANTALLA' || it.tipo === 'MOD_LOGICA' || it.tipo === 'DOCUMENTO');
    if (despliegues.length && despliegues.every(x => x === 'REMOTO')) {
      overrides.SIT_DESPLIEGUE_MODIFICACIONES = { lugar: 'OFICINA', fase: 'PRUEBAS', rol: 'IS', nombre: 'Descarga y prueba remota de modificaciones' };
      overrides.SIT_SAT = { lugar: 'OFICINA', fase: 'PRUEBAS', nombre: 'Aceptación remota con el cliente' };
      if (soloModificaciones) sinSitio = true;
    } else if (despliegues.length && despliegues.every(x => x === 'NINGUNO')) {
      overrides.SIT_DESPLIEGUE_MODIFICACIONES = { excluir: true };
      if (soloModificaciones) sinSitio = true;
    }
    return { drivers, overrides, avisos, sinSitio };
  }

  return { PLANTILLAS, TIPOS_ALCANCE, FASES_SITIO_BASE, alcanceADrivers };
});
