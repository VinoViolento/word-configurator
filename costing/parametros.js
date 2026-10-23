/**
 * parametros.js — Parámetros calibrables del modelo de costeo de horas DeltaV.
 *
 * TODO valor aquí es una SEMILLA razonable de la industria, NO un estándar oficial.
 * La idea es que se calibre con datos históricos (ver docs/modelo-costeo-horas.md §12).
 *
 * Convenciones de magnitudes:
 *  - Horas siempre en horas-persona (h).
 *  - Un parámetro numérico puede reemplazarse por un estimado de tres puntos:
 *      { o: optimista, m: más probable, p: pesimista }  ó  [o, m, p]
 *    El motor lo convierte a media/desvío (PERT). Si se da un número, el motor aplica
 *    el rango relativo por lugar definido en `incertidumbre.rangoRelativo`.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DeltaVCosteo = root.DeltaVCosteo || {};
  root.DeltaVCosteo.parametros = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const PARAMETROS = {
    version: '0.1.0',

    /** Jornadas laborales. */
    jornada: {
      horasDiaOficina: 8,
      horasDiaSitio: 10,
      diasSemana: 5,
      horasSemanaEfectivas: 32,   // horas productivas/semana por ingeniero (para estimar duración)
      equipoMaximo: 8,            // ingenieros simultáneos máximos (para estimar duración)
      horasPorIngenieroEquipo: 400 // cada ~400 h de alcance suma un ingeniero al equipo
    },

    /**
     * Factores multiplicativos globales. Cada actividad del catálogo declara cuáles
     * le aplican (`factores: ['complejidad', ...]`).
     */
    factores: {
      /** Complejidad del proceso / estrategias de control. */
      complejidad: { BAJA: 0.85, MEDIA: 1.0, ALTA: 1.25, MUY_ALTA: 1.5 },
      /** Exigencia documental del cliente (p.ej. O&G / farma = RIGUROSO). */
      nivelDocumentacion: { BASICO: 0.8, ESTANDAR: 1.0, RIGUROSO: 1.3 },
      /** Disponibilidad de librería de típicos / clases probadas. */
      libreriaTipicos: { SIN: 1.0, PARCIAL: 0.85, COMPLETA: 0.7 },
      /** Condiciones de sitio: permisos, áreas clasificadas, clima, acceso. */
      condicionesSitio: { NORMAL: 1.0, EXIGENTE: 1.15, SEVERA: 1.3 },
      /** Reúso del sistema existente (lo fija la plantilla de tipo de proyecto). */
      reusoSoftware: { PLANTA_NUEVA: 1.0, EXPANSION: 0.85, MIGRACION: 0.75, TRABAJO_MENOR: 0.9 }, // MIGRACION: la conversión (SW_MIGRACION_BD) cubre parte de la configuración
      reusoHardware: { PLANTA_NUEVA: 1.0, EXPANSION: 0.9, MIGRACION: 0.95, TRABAJO_MENOR: 1.0 },
      /** Planta en operación (brownfield): coordinación, permisos, ventanas. Aplica a sitio. */
      brownfield: { PLANTA_NUEVA: 1.0, EXPANSION: 1.15, MIGRACION: 1.25, TRABAJO_MENOR: 1.1 }
    },

    /**
     * Similitud y aprendizaje.
     *  - phi: fracción de ítems únicos cuando el usuario no informa `unicos`.
     *  - LR: tasa de aprendizaje (Wright). 0.9 => la 2ª unidad única cuesta 90% de la 1ª.
     *    b = -log2(LR). Horas de k únicos = u * k^(1-b).
     *  - rho (clon): costo relativo de una copia de un ítem ya hecho (se declara por término
     *    en el catálogo; este es el valor por defecto si el término dice `clon: true`).
     */
    similitud: {
      LR: 0.9,
      rhoPorDefecto: 0.25,
      phiPorDefecto: 0.4,
      phi: {
        PLANTA_NUEVA: { modulos: 0.30, graficos: 0.50, gabinetes: 0.40, interfaces: 0.6, secuencias: 0.5 },
        EXPANSION:    { modulos: 0.20, graficos: 0.40, gabinetes: 0.50, interfaces: 0.6, secuencias: 0.4 },
        MIGRACION:    { modulos: 0.35, graficos: 0.50, gabinetes: 0.40, interfaces: 0.7, secuencias: 0.5 },
        TRABAJO_MENOR:{ modulos: 0.50, graficos: 0.70, gabinetes: 0.70, interfaces: 0.8, secuencias: 0.7 }
      }
    },

    /** Cuadrillas en sitio: eficiencia decreciente con el tamaño (coordinación). */
    cuadrillas: {
      kappa: 0.05,         // e(c) = max(eficienciaMinima, 1 - kappa*(c-1))
      eficienciaMinima: 0.6,
      personasMaximas: 6
    },

    /** Movilización. */
    movilizacion: {
      rotacionDias: 20,     // días continuos en sitio antes de rotar (viaje ida/vuelta)
      horasViajeIda: 8,     // horas-persona por tramo (ida o vuelta)
      diasViajePorViaje: 2, // días de viático que consume un viaje ida+vuelta
      presenciaLider: 1.0   // fracción de los días calendario que el líder técnico está en sitio
    },

    /** Transferencia de calidad FAT -> COM: H_COM = H_COM0 * (1 - tau * coberturaFAT). */
    transferenciaFAT: { tau: 0.3, coberturaPorDefecto: { PLANTA_NUEVA: 0.8, EXPANSION: 0.6, MIGRACION: 0.6, TRABAJO_MENOR: 0.0 } },

    /** Contingencia según tipo de emisión (coincide con el campo "Emisión" del add-in). */
    contingencia: {
      PRESUPUESTARIA: 0.15,
      FIRME: 0.08,
      alias: { 'Emisión Presupuestaria': 'PRESUPUESTARIA', 'Emisión a Firme': 'FIRME' }
    },

    /** Incertidumbre (PERT). */
    incertidumbre: {
      /** Rango relativo [bajo, alto] aplicado a un parámetro dado como número. */
      rangoRelativo: { OFICINA: [-0.15, 0.35], TALLER: [-0.10, 0.25], SITIO: [-0.20, 0.50] },
      /** Correlación equicorrelacionada entre actividades: sigma_tot² = (1-r)·Σσ² + r·(Σσ)². */
      correlacion: 0.3,
      z: { P50: 0, P80: 0.8416, P90: 1.2816 }
    },

    /** Roles (para agrupar horas y aplicar tarifas). */
    roles: {
      GP:   'Gerente de proyecto',
      LI:   'Líder de ingeniería / líder técnico',
      IS:   'Ingeniero de configuración (software)',
      IH:   'Ingeniero de hardware',
      DT:   'Dibujante / documentador',
      QA:   'Calidad',
      TT:   'Técnico de taller',
      IC:   'Ingeniero de comisionamiento',
      TS:   'Técnico de sitio',
      INST: 'Instructor'
    },

    /** Parámetros de duración (para horas de gestión por semana). */
    duracion: { porcentajeSitioEnDuracion: 1.0 }
  };

  return PARAMETROS;
});
