/**
 * gabinetes.js — Adaptador entre la herramienta de gabinetes y el modelo de horas.
 *
 * La herramienta de gabinetes (en desarrollo en paralelo) debe entregar una lista de gabinetes
 * con este contrato mínimo:
 *
 *   {
 *     id: 'GAB-01',
 *     tipo: 'SISTEMA' | 'MARSHALLING' | 'REMOTO' | 'RED' | 'OTRO',
 *     plantilla: 'A',                 // opcional: clave de diseño; gabinetes con la misma clave son clones
 *     existente: false,               // true => gabinete existente a intervenir (cutover/integración), no a fabricar
 *     tarjetas: [                     // opcional si se informa `io`
 *       { modelo: 'AI-8-HART', cantidad: 4 },
 *       { modelo: 'FF-H1-2P', cantidad: 1, dispositivos: 14 },
 *       { modelo: 'OTRA', cantidad: 1, canales: 16, senal: 'DI' }   // tarjeta fuera de catálogo
 *     ],
 *     io: { AI: 32, AO: 8, DI: 64, DO: 32, RTD_TC: 0, HART: 40, FF: 0, PROFIBUS: 0 }, // alternativa a tarjetas
 *     controladores: 2, cioc: 0, estaciones: 0, switches: 2,
 *     componentes: 85,                // ítems BOM montados; si falta, se estima
 *     terminaciones: 640,             // puntos de conexión; si falta, se estima
 *     interfaces: 0                   // enlaces serie/ethernet a terceros alojados en este gabinete
 *   }
 *
 * Salida: drivers parciales listos para `motor.calcular` + detalle por gabinete.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DeltaVCosteo = root.DeltaVCosteo || {};
  root.DeltaVCosteo.gabinetes = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /** Catálogo mínimo de tarjetas DeltaV (M-series, S-series, CHARMs). Ampliable desde la herramienta de gabinetes. */
  const CATALOGO_TARJETAS = {
    'AI-8': { io_AI: 8 },
    'AI-8-HART': { io_AI: 8, io_HART: 8 },
    'AI-16-HART': { io_AI: 16, io_HART: 16 },
    'AO-8': { io_AO: 8 },
    'AO-8-HART': { io_AO: 8, io_HART: 8 },
    'DI-8': { io_DI: 8 },
    'DI-32': { io_DI: 32 },
    'DO-8': { io_DO: 8 },
    'DO-32': { io_DO: 32 },
    'RTD-8': { io_RTD_TC: 8 },
    'TC-8': { io_RTD_TC: 8 },
    'ISO-AI-8': { io_AI: 8, io_HART: 8 },
    'SERIAL-2P': { interfaces_terceros: 2 },
    'FF-H1-2P': { dispositivos: 'io_FF' },        // requiere `dispositivos`
    'PROFIBUS-DP-1P': { dispositivos: 'io_PROFIBUS' },
    'DEVICENET-1P': { dispositivos: 'io_PROFIBUS' }, // esfuerzo asimilado a Profibus
    'CHARM-BASEPLATE': {},                           // 12 CHARMs por baseplate; las CHARMs se listan aparte
    'CHARM-AI': { io_AI: 1, io_HART: 1 },
    'CHARM-AO': { io_AO: 1, io_HART: 1 },
    'CHARM-DI': { io_DI: 1 },
    'CHARM-DO': { io_DO: 1 },
    'CHARM-RTD': { io_RTD_TC: 1 },
    'CHARM-TC': { io_RTD_TC: 1 }
  };

  /** Valores por defecto para estimar componentes y terminaciones cuando la herramienta no los informa. */
  const ESTIMACION = {
    componentesBase: { SISTEMA: 40, MARSHALLING: 30, REMOTO: 35, RED: 25, OTRO: 25 },
    componentesPorTarjeta: 1.5,
    componentesPorCanal: 0.3,
    terminacionesBase: 20,
    terminacionesPorCanal: { SISTEMA: 2, MARSHALLING: 4, REMOTO: 3, RED: 0, OTRO: 2 },
    terminacionesPorComponente: 2
  };

  const SENALES = ['AI', 'AO', 'DI', 'DO', 'RTD_TC', 'HART', 'FF', 'PROFIBUS'];

  function ioDeTarjetas(tarjetas, catalogo, avisos, idGab) {
    const io = {}; let nTarjetas = 0; let interfaces = 0;
    SENALES.forEach(s => { io[s] = 0; });
    (tarjetas || []).forEach(t => {
      const q = t.cantidad == null ? 1 : t.cantidad;
      nTarjetas += q;
      const def = catalogo[t.modelo];
      if (!def) {
        if (t.canales && t.senal) io[t.senal] = (io[t.senal] || 0) + q * t.canales;
        else avisos.push(`${idGab}: tarjeta "${t.modelo}" fuera de catálogo sin canales/senal; no aporta E/S`);
        return;
      }
      Object.keys(def).forEach(k => {
        if (k === 'dispositivos') {
          const dest = def[k].replace('io_', '');
          if (t.dispositivos == null) avisos.push(`${idGab}: tarjeta de bus "${t.modelo}" sin "dispositivos"`);
          io[dest] += q * (t.dispositivos || 0);
        } else if (k === 'interfaces_terceros') {
          interfaces += q * def[k];
        } else {
          io[k.replace('io_', '')] += q * def[k];
        }
      });
    });
    return { io, nTarjetas, interfaces };
  }

  /**
   * Convierte la lista de gabinetes en drivers del modelo.
   * @param {Array} lista  gabinetes según contrato
   * @param {object} [opciones] { catalogoTarjetas: {...extra}, estimacion: {...} }
   */
  function aDrivers(lista, opciones) {
    opciones = opciones || {};
    const catalogo = Object.assign({}, CATALOGO_TARJETAS, opciones.catalogoTarjetas || {});
    const est = Object.assign({}, ESTIMACION, opciones.estimacion || {});
    const avisos = [];
    const detalle = [];
    const firmas = new Set();
    const d = {
      gabinetes: { total: 0, unicos: 0 }, gabinetes_afectados: 0, tarjetas: 0, componentes: 0, terminaciones: 0,
      controladores: 0, estaciones: 0, switches: 0, interfaces_terceros: 0
    };
    SENALES.forEach(s => { d['io_' + s] = 0; });

    (lista || []).forEach((g, i) => {
      const id = g.id || `GAB-${i + 1}`;
      const tipo = (g.tipo || 'OTRO').toUpperCase();
      let io, nTarjetas = 0, interfaces = g.interfaces || 0;
      if (g.tarjetas && g.tarjetas.length) {
        const r = ioDeTarjetas(g.tarjetas, catalogo, avisos, id);
        io = r.io; nTarjetas = r.nTarjetas; interfaces += r.interfaces;
      } else {
        io = {}; SENALES.forEach(s => { io[s] = (g.io && g.io[s]) || 0; });
        nTarjetas = g.tarjetasTotal || 0;
      }
      const canales = io.AI + io.AO + io.DI + io.DO + io.RTD_TC + io.FF + io.PROFIBUS;
      const componentes = g.componentes != null ? g.componentes
        : Math.round((est.componentesBase[tipo] || est.componentesBase.OTRO) + est.componentesPorTarjeta * nTarjetas + est.componentesPorCanal * canales);
      const terminaciones = g.terminaciones != null ? g.terminaciones
        : Math.round(est.terminacionesBase + (est.terminacionesPorCanal[tipo] || 0) * canales
          + (g.tarjetas || g.io ? 0 : est.terminacionesPorComponente * componentes));

      const firma = g.plantilla || [tipo, ...(g.tarjetas || []).map(t => `${t.modelo}x${t.cantidad == null ? 1 : t.cantidad}`).sort()].join('|');
      const esClon = firmas.has(firma);
      firmas.add(firma);

      if (g.existente) {
        d.gabinetes_afectados += 1;
      } else {
        d.gabinetes.total += 1;
        if (!esClon) d.gabinetes.unicos += 1;
        d.tarjetas += nTarjetas;
        d.componentes += componentes;
        d.terminaciones += terminaciones;
      }
      SENALES.forEach(s => { d['io_' + s] += io[s]; });
      d.controladores += (g.controladores || 0) + (g.cioc || 0);
      d.estaciones += g.estaciones || 0;
      d.switches += g.switches || 0;
      d.interfaces_terceros += interfaces;

      detalle.push({ id, tipo, firma, esClon, existente: !!g.existente, io, canales, tarjetas: nTarjetas, componentes, terminaciones });
    });

    return { drivers: d, detalle, avisos };
  }

  return { CATALOGO_TARJETAS, ESTIMACION, SENALES, aDrivers };
});
