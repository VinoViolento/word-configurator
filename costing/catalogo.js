/**
 * catalogo.js — Catálogo de actividades del modelo de costeo de horas DeltaV.
 *
 * Cada actividad es una fila de la matriz Actividad x Driver. El motor calcula:
 *
 *   H_a = [ F_a + Σ_d u_{a,d} · n_ef_{a,d} ] · M_a · Π f(a)
 *
 * donde n_ef aplica similitud/aprendizaje (ver docs §5) cuando el término declara `clon`.
 *
 * Campos:
 *  id, nombre            identificación
 *  lugar                 OFICINA | TALLER | SITIO
 *  fase                  etapa (para reportes y, en SITIO, para el calendario de cuadrillas)
 *  rol                   rol que ejecuta (ver parametros.roles)
 *  fijo                  horas fijas F_a (se cuentan UNA sola vez por proyecto)
 *  fijoCondicional       si true, F_a sólo se cobra cuando Σ términos > 0
 *  terminos[]            { driver, unitario, clon?, phi? }
 *                          unitario : horas por unidad (número o tres puntos)
 *                          clon     : ρ = costo relativo de una copia (0..1). Activa similitud.
 *                          phi      : clave de phi (modulos|graficos|gabinetes|interfaces|secuencias)
 *                                     para estimar únicos cuando el driver no los informa
 *  multiplicador         factor fijo (p.ej. 2 personas en FAT presenciada)
 *  factores[]            factores globales que aplican (claves de parametros.factores)
 *  etiquetas[]           grupos para actividades derivadas
 *  derivada              { porcentaje, grupo, porSemana?, orden } ó { calendario: 'liderTecnico'|'movilizacion', orden }
 *  plantillas[]          tipos de proyecto donde aplica por defecto ('*' = todos)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.DeltaVCosteo = root.DeltaVCosteo || {};
  root.DeltaVCosteo.catalogo = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const TODOS = ['PLANTA_NUEVA', 'EXPANSION', 'MIGRACION', 'TRABAJO_MENOR'];
  const MAYORES = ['PLANTA_NUEVA', 'EXPANSION', 'MIGRACION'];
  const BROWN = ['EXPANSION', 'MIGRACION'];

  /** Drivers reconocidos (los no listados se aceptan igual, pero se avisa). */
  const DRIVERS = {
    // Entradas/salidas físicas (canales)
    io_AI: 'Entradas analógicas (canales)',
    io_AO: 'Salidas analógicas (canales)',
    io_DI: 'Entradas discretas (canales)',
    io_DO: 'Salidas discretas (canales)',
    io_RTD_TC: 'Entradas de temperatura RTD/TC (canales)',
    io_HART: 'Dispositivos HART (adicional sobre AI/AO)',
    io_FF: 'Dispositivos Foundation Fieldbus',
    io_PROFIBUS: 'Dispositivos Profibus DP/PA',
    io_SERIE_MODBUS: 'Puntos por enlaces serie / Modbus',
    io_OPC: 'Puntos por OPC / Ethernet',
    // Hardware / nodos
    controladores: 'Controladores (MD Plus, MX, MQ, PK, SZ)',
    estaciones: 'Estaciones (ProPlus, App Station, Operador)',
    switches: 'Switches de red',
    gabinetes: 'Gabinetes (sistema, marshalling, remoto, red)',
    tarjetas: 'Tarjetas de E/S (incl. CHARMs / baseplates)',
    componentes: 'Componentes montados en gabinetes (ítems BOM)',
    terminaciones: 'Terminaciones de cable (puntos de conexión)',
    // Software
    modulos_simples: 'Módulos de control simples (indicación, cálculo)',
    modulos_medios: 'Módulos medios (PID, motor, válvula, totalizador)',
    modulos_complejos: 'Módulos complejos (cascada, relación, matriz enclavamiento)',
    fases_secuencia: 'Fases / secuencias SFC',
    unidades_batch: 'Unidades / recetas Batch',
    sif: 'Funciones instrumentadas de seguridad (SIS)',
    graficos_overview: 'Gráficos overview',
    graficos_proceso: 'Gráficos de proceso',
    graficos_detalle: 'Gráficos de detalle / faceplates / pop-ups',
    graficos_tendencia: 'Grupos de tendencia / históricos',
    alarmas: 'Alarmas a configurar',
    alarmas_racionalizar: 'Alarmas a racionalizar (taller con cliente)',
    interfaces_terceros: 'Enlaces a terceros (Modbus, OPC, Profibus, EtherNet/IP)',
    reportes: 'Reportes / informes',
    documentos_entregables: 'Documentos entregables (con control documental)',
    cursos_capacitacion: 'Cursos de capacitación',
    // Trabajos menores / modificaciones
    graficos_mod_S: 'Modificaciones de pantalla pequeñas',
    graficos_mod_M: 'Modificaciones de pantalla medianas',
    graficos_mod_L: 'Modificaciones de pantalla grandes / pantalla nueva en sistema existente',
    modulos_mod_simples: 'Modificaciones de lógica simples',
    modulos_mod_medios: 'Modificaciones de lógica medias',
    modulos_mod_complejos: 'Modificaciones de lógica complejas',
    fases_mod: 'Modificaciones de secuencias',
    componentes_integrar: 'Componentes a integrar en gabinete existente',
    terminaciones_integrar: 'Terminaciones de cable por integración',
    reemplazo_tarjetas: 'Tarjetas / CHARMs a reemplazar',
    reemplazo_controladores: 'Controladores a reemplazar',
    reemplazo_estaciones: 'Estaciones a reemplazar / reinstalar',
    io_afectado: 'E/S afectadas por un cambio (re-prueba)',
    gabinetes_afectados: 'Gabinetes existentes afectados (cutover / intervención)',
    // Sitio (entradas directas en días)
    dias_pem: 'Días de soporte a puesta en marcha',
    dias_supervision_montaje: 'Días de supervisión de montaje (si se fija; si no, se deriva)'
  };

  /** Drivers derivados que el motor calcula automáticamente. */
  const DRIVERS_DERIVADOS = {
    io_fisico: (d) => d.io_AI + d.io_AO + d.io_DI + d.io_DO + d.io_RTD_TC,
    io_bus: (d) => d.io_FF + d.io_PROFIBUS,
    puntos_interfaz: (d) => d.io_SERIE_MODBUS + d.io_OPC,
    io_total: (d) => d.io_fisico + d.io_bus + d.puntos_interfaz,
    modulos_total: (d) => d.modulos_simples + d.modulos_medios + d.modulos_complejos + d.fases_secuencia + d.unidades_batch + d.sif,
    graficos_total: (d) => d.graficos_overview + d.graficos_proceso + d.graficos_detalle + d.graficos_tendencia,
    graficos_mod_total: (d) => d.graficos_mod_S + d.graficos_mod_M + d.graficos_mod_L,
    modulos_mod_total: (d) => d.modulos_mod_simples + d.modulos_mod_medios + d.modulos_mod_complejos + d.fases_mod,
    nodos: (d) => d.controladores + d.estaciones + d.switches
  };

  const ACTIVIDADES = [
    // ───────────────────────── GESTIÓN ─────────────────────────
    {
      id: 'GP_GESTION', nombre: 'Gestión de proyecto (planificación, seguimiento, reuniones, cierre)',
      lugar: 'OFICINA', fase: 'GESTION', rol: 'GP',
      derivada: { porcentaje: 0.10, grupo: 'NO_SITIO', porSemana: 4, orden: 3 },
      plantillas: TODOS
    },
    {
      id: 'GP_KICKOFF', nombre: 'Kick-off, reuniones de definición y coordinación con cliente',
      lugar: 'OFICINA', fase: 'GESTION', rol: 'LI', fijo: 16, terminos: [], factores: [],
      plantillas: TODOS
    },
    {
      id: 'QA_CALIDAD', nombre: 'Aseguramiento de calidad (revisiones, auditorías internas)',
      lugar: 'OFICINA', fase: 'GESTION', rol: 'QA',
      derivada: { porcentaje: 0.03, grupo: 'NO_SITIO', orden: 3 },
      factores: ['nivelDocumentacion'],
      plantillas: TODOS
    },

    // ───────────────────────── DEFINICIÓN ─────────────────────────
    {
      id: 'ING_REVISION_REQUISITOS', nombre: 'Revisión de requisitos, P&ID, listados y normas del cliente',
      lugar: 'OFICINA', fase: 'DEFINICION', rol: 'LI', fijo: 16,
      terminos: [{ driver: 'io_total', unitario: 0.02 }, { driver: 'modulos_total', unitario: 0.05 }],
      factores: ['nivelDocumentacion', 'complejidad'],
      plantillas: TODOS
    },
    {
      id: 'DOC_FDS', nombre: 'Especificación funcional (FDS) / filosofía de control',
      lugar: 'OFICINA', fase: 'DEFINICION', rol: 'IS', fijo: 24,
      terminos: [
        { driver: 'modulos_medios', unitario: 0.5, clon: 0.1, phi: 'modulos' },
        { driver: 'modulos_complejos', unitario: 1.5, clon: 0.1, phi: 'modulos' },
        { driver: 'fases_secuencia', unitario: 3, clon: 0.2, phi: 'secuencias' },
        { driver: 'unidades_batch', unitario: 6, clon: 0.2, phi: 'secuencias' },
        { driver: 'sif', unitario: 2, clon: 0.2, phi: 'modulos' },
        { driver: 'graficos_proceso', unitario: 0.5, clon: 0.2, phi: 'graficos' },
        { driver: 'interfaces_terceros', unitario: 2 }
      ],
      factores: ['nivelDocumentacion', 'complejidad', 'reusoSoftware'],
      etiquetas: ['DOCUMENTOS'],
      plantillas: MAYORES
    },
    {
      id: 'ING_ARQUITECTURA', nombre: 'Arquitectura de sistema (topología, redundancia, licenciamiento)',
      lugar: 'OFICINA', fase: 'DEFINICION', rol: 'IH', fijo: 16,
      terminos: [{ driver: 'nodos', unitario: 1 }],
      factores: ['complejidad', 'reusoHardware'],
      plantillas: MAYORES
    },

    // ───────────────────────── INGENIERÍA DE HARDWARE ─────────────────────────
    {
      id: 'HW_LISTADO_IO', nombre: 'Listado de E/S y asignación de canales',
      lugar: 'OFICINA', fase: 'INGENIERIA_HW', rol: 'IH', fijo: 4,
      terminos: [{ driver: 'io_total', unitario: 0.05 }],
      factores: ['nivelDocumentacion'], etiquetas: ['DOCUMENTOS'],
      plantillas: TODOS
    },
    {
      id: 'HW_PLANOS_GABINETE', nombre: 'Planos de gabinete (disposición, arreglo general, alimentación)',
      lugar: 'OFICINA', fase: 'INGENIERIA_HW', rol: 'DT',
      terminos: [{ driver: 'gabinetes', unitario: 16, clon: 0.2, phi: 'gabinetes' }],
      factores: ['nivelDocumentacion', 'reusoHardware'], etiquetas: ['PLANOS'],
      plantillas: TODOS
    },
    {
      id: 'HW_PLANOS_CABLEADO', nombre: 'Diagramas de conexionado / terminación (lazos)',
      lugar: 'OFICINA', fase: 'INGENIERIA_HW', rol: 'DT',
      terminos: [
        { driver: 'io_fisico', unitario: 0.4 },
        { driver: 'io_bus', unitario: 0.25 },
        { driver: 'componentes_integrar', unitario: 0.5 }
      ],
      factores: ['nivelDocumentacion', 'reusoHardware'], etiquetas: ['PLANOS'],
      plantillas: TODOS
    },
    {
      id: 'HW_BOM_COMPRAS', nombre: 'Lista de materiales (BOM), especificación y gestión de compras',
      lugar: 'OFICINA', fase: 'INGENIERIA_HW', rol: 'IH',
      terminos: [
        { driver: 'gabinetes', unitario: 4, clon: 0.5, phi: 'gabinetes' },
        { driver: 'componentes', unitario: 0.1 },
        { driver: 'componentes_integrar', unitario: 0.3 },
        { driver: 'reemplazo_tarjetas', unitario: 0.5 },
        { driver: 'reemplazo_controladores', unitario: 1 },
        { driver: 'reemplazo_estaciones', unitario: 2 }
      ],
      factores: [],
      plantillas: TODOS
    },
    {
      id: 'HW_CALCULOS', nombre: 'Cálculos (disipación térmica, consumo, puesta a tierra, caída de tensión)',
      lugar: 'OFICINA', fase: 'INGENIERIA_HW', rol: 'IH',
      terminos: [{ driver: 'gabinetes', unitario: 3, clon: 0.2, phi: 'gabinetes' }],
      factores: ['nivelDocumentacion'], etiquetas: ['DOCUMENTOS'],
      plantillas: TODOS
    },
    {
      id: 'HW_REDES', nombre: 'Diseño de redes (ACN, direccionamiento, switches, seguridad perimetral)',
      lugar: 'OFICINA', fase: 'INGENIERIA_HW', rol: 'IH', fijo: 8, fijoCondicional: true,
      terminos: [
        { driver: 'switches', unitario: 2 },
        { driver: 'estaciones', unitario: 1 },
        { driver: 'controladores', unitario: 1 }
      ],
      factores: ['complejidad', 'reusoHardware'],
      plantillas: TODOS
    },

    // ───────────────────────── INGENIERÍA DE SOFTWARE ─────────────────────────
    {
      id: 'SW_SETUP_SISTEMA', nombre: 'Instalación y configuración de sistema (ProPlus, estaciones, controladores, dominio, licencias)',
      lugar: 'OFICINA', fase: 'INGENIERIA_SW', rol: 'IS', fijo: 16, fijoCondicional: true,
      terminos: [
        { driver: 'estaciones', unitario: 8 },
        { driver: 'controladores', unitario: 6 },
        { driver: 'reemplazo_estaciones', unitario: 6 },
        { driver: 'reemplazo_controladores', unitario: 3 }
      ],
      factores: ['complejidad'],
      plantillas: TODOS
    },
    {
      id: 'SW_BASE_DATOS_IO', nombre: 'Base de datos de E/S (canales, tags, escalas, DST)',
      lugar: 'OFICINA', fase: 'INGENIERIA_SW', rol: 'IS',
      terminos: [
        { driver: 'io_fisico', unitario: 0.2 },
        { driver: 'io_HART', unitario: 0.15 },
        { driver: 'io_FF', unitario: 0.5 },
        { driver: 'io_PROFIBUS', unitario: 0.4 },
        { driver: 'puntos_interfaz', unitario: 0.1 }
      ],
      factores: ['reusoSoftware', 'libreriaTipicos'], etiquetas: ['SW_CONFIG'],
      plantillas: TODOS
    },
    {
      id: 'SW_MODULOS_SIMPLES', nombre: 'Módulos de control simples',
      lugar: 'OFICINA', fase: 'INGENIERIA_SW', rol: 'IS',
      terminos: [{ driver: 'modulos_simples', unitario: 1.5, clon: 0.2, phi: 'modulos' }],
      factores: ['complejidad', 'libreriaTipicos', 'reusoSoftware'], etiquetas: ['SW_CONFIG'],
      plantillas: TODOS
    },
    {
      id: 'SW_MODULOS_MEDIOS', nombre: 'Módulos de control medios (PID, motores, válvulas)',
      lugar: 'OFICINA', fase: 'INGENIERIA_SW', rol: 'IS',
      terminos: [{ driver: 'modulos_medios', unitario: 4, clon: 0.2, phi: 'modulos' }],
      factores: ['complejidad', 'libreriaTipicos', 'reusoSoftware'], etiquetas: ['SW_CONFIG'],
      plantillas: TODOS
    },
    {
      id: 'SW_MODULOS_COMPLEJOS', nombre: 'Módulos de control complejos (cascadas, enclavamientos, relación)',
      lugar: 'OFICINA', fase: 'INGENIERIA_SW', rol: 'IS',
      terminos: [{ driver: 'modulos_complejos', unitario: 12, clon: 0.2, phi: 'modulos' }],
      factores: ['complejidad', 'libreriaTipicos', 'reusoSoftware'], etiquetas: ['SW_CONFIG'],
      plantillas: TODOS
    },
    {
      id: 'SW_SECUENCIAS', nombre: 'Secuencias / fases SFC',
      lugar: 'OFICINA', fase: 'INGENIERIA_SW', rol: 'IS',
      terminos: [{ driver: 'fases_secuencia', unitario: 20, clon: 0.3, phi: 'secuencias' }],
      factores: ['complejidad', 'libreriaTipicos', 'reusoSoftware'], etiquetas: ['SW_CONFIG'],
      plantillas: TODOS
    },
    {
      id: 'SW_BATCH', nombre: 'Batch (unidades, recetas, Batch Executive)',
      lugar: 'OFICINA', fase: 'INGENIERIA_SW', rol: 'IS', fijo: 24, fijoCondicional: true,
      terminos: [{ driver: 'unidades_batch', unitario: 40, clon: 0.3, phi: 'secuencias' }],
      factores: ['complejidad', 'libreriaTipicos', 'reusoSoftware'], etiquetas: ['SW_CONFIG'],
      plantillas: TODOS
    },
    {
      id: 'SW_SIS', nombre: 'SIS (SIF, lógica de seguridad, SZ/CSLS)',
      lugar: 'OFICINA', fase: 'INGENIERIA_SW', rol: 'IS', fijo: 24, fijoCondicional: true,
      terminos: [{ driver: 'sif', unitario: 16, clon: 0.3, phi: 'modulos' }],
      factores: ['complejidad', 'libreriaTipicos', 'nivelDocumentacion'], etiquetas: ['SW_CONFIG'],
      plantillas: TODOS
    },
    {
      id: 'SW_GRAFICOS', nombre: 'Gráficos de operación (overview, proceso, detalle, tendencias)',
      lugar: 'OFICINA', fase: 'INGENIERIA_SW', rol: 'IS',
      terminos: [
        { driver: 'graficos_overview', unitario: 16, clon: 0.3, phi: 'graficos' },
        { driver: 'graficos_proceso', unitario: 12, clon: 0.3, phi: 'graficos' },
        { driver: 'graficos_detalle', unitario: 4, clon: 0.2, phi: 'graficos' },
        { driver: 'graficos_tendencia', unitario: 2, clon: 0.5, phi: 'graficos' }
      ],
      factores: ['complejidad', 'libreriaTipicos', 'reusoSoftware'], etiquetas: ['SW_CONFIG'],
      plantillas: TODOS
    },
    {
      id: 'SW_ALARMAS', nombre: 'Configuración y racionalización de alarmas',
      lugar: 'OFICINA', fase: 'INGENIERIA_SW', rol: 'IS',
      terminos: [{ driver: 'alarmas', unitario: 0.1 }, { driver: 'alarmas_racionalizar', unitario: 0.25 }],
      factores: ['nivelDocumentacion'], etiquetas: ['SW_CONFIG'],
      plantillas: TODOS
    },
    {
      id: 'SW_INTERFACES', nombre: 'Interfaces con terceros (Modbus, OPC, Profibus, EtherNet/IP)',
      lugar: 'OFICINA', fase: 'INGENIERIA_SW', rol: 'IS',
      terminos: [
        { driver: 'interfaces_terceros', unitario: 16, clon: 0.5, phi: 'interfaces' },
        { driver: 'puntos_interfaz', unitario: 0.1 }
      ],
      factores: ['complejidad'], etiquetas: ['SW_CONFIG'],
      plantillas: TODOS
    },
    {
      id: 'SW_HISTORIAN_REPORTES', nombre: 'Historian, colección de datos y reportes',
      lugar: 'OFICINA', fase: 'INGENIERIA_SW', rol: 'IS', fijo: 8, fijoCondicional: true,
      terminos: [{ driver: 'io_total', unitario: 0.03 }, { driver: 'reportes', unitario: 6 }],
      factores: ['complejidad'], etiquetas: ['SW_CONFIG'],
      plantillas: TODOS
    },
    {
      id: 'SW_MOD_GRAFICOS', nombre: 'Modificación de pantallas existentes',
      lugar: 'OFICINA', fase: 'INGENIERIA_SW', rol: 'IS',
      terminos: [
        { driver: 'graficos_mod_S', unitario: 2 },
        { driver: 'graficos_mod_M', unitario: 6 },
        { driver: 'graficos_mod_L', unitario: 12, clon: 0.3, phi: 'graficos' }
      ],
      factores: ['complejidad'], etiquetas: ['SW_CONFIG'],
      plantillas: TODOS
    },
    {
      id: 'SW_MOD_LOGICA', nombre: 'Modificación de lógica existente',
      lugar: 'OFICINA', fase: 'INGENIERIA_SW', rol: 'IS',
      terminos: [
        { driver: 'modulos_mod_simples', unitario: 1 },
        { driver: 'modulos_mod_medios', unitario: 2.5 },
        { driver: 'modulos_mod_complejos', unitario: 6 },
        { driver: 'fases_mod', unitario: 10 }
      ],
      factores: ['complejidad'], etiquetas: ['SW_CONFIG'],
      plantillas: TODOS
    },
    {
      id: 'SW_MIGRACION_BD', nombre: 'Conversión / migración de base de datos legada',
      lugar: 'OFICINA', fase: 'INGENIERIA_SW', rol: 'IS', fijo: 40,
      terminos: [{ driver: 'io_total', unitario: 0.3 }, { driver: 'modulos_total', unitario: 1 }],
      factores: ['complejidad'], etiquetas: ['SW_CONFIG'],
      plantillas: ['MIGRACION']
    },

    // ───────────────────────── PRUEBAS ─────────────────────────
    {
      id: 'PRU_INTERNAS', nombre: 'Pruebas internas (pre-FAT, simulación, revisión de pares)',
      lugar: 'OFICINA', fase: 'PRUEBAS', rol: 'IS',
      derivada: { porcentaje: 0.25, grupo: 'SW_CONFIG', orden: 1 },
      factores: ['nivelDocumentacion'],
      plantillas: TODOS
    },
    {
      id: 'PRU_FAT_PREPARACION', nombre: 'Preparación de FAT (simulación, protocolos, montaje de pruebas)',
      lugar: 'OFICINA', fase: 'PRUEBAS', rol: 'IS', fijo: 16, fijoCondicional: true,
      // Los típicos se preparan una vez; las instancias sólo se tabulan (clon 0.3). Los registros Modbus se verifican en bloque.
      terminos: [
        { driver: 'io_fisico', unitario: 0.05 },
        { driver: 'io_bus', unitario: 0.05 },
        { driver: 'puntos_interfaz', unitario: 0.01 },
        { driver: 'modulos_simples', unitario: 0.1, clon: 0.3, phi: 'modulos' },
        { driver: 'modulos_medios', unitario: 0.2, clon: 0.3, phi: 'modulos' },
        { driver: 'modulos_complejos', unitario: 0.6, clon: 0.3, phi: 'modulos' },
        { driver: 'fases_secuencia', unitario: 1.5, clon: 0.3, phi: 'secuencias' },
        { driver: 'unidades_batch', unitario: 3, clon: 0.3, phi: 'secuencias' },
        { driver: 'sif', unitario: 1, clon: 0.3, phi: 'modulos' }
      ],
      factores: ['nivelDocumentacion'],
      plantillas: MAYORES
    },
    {
      id: 'PRU_FAT_EJECUCION', nombre: 'Ejecución de FAT presenciada por el cliente',
      lugar: 'OFICINA', fase: 'PRUEBAS', rol: 'IS', multiplicador: 2,
      // 2 ingenieros (uno ejecuta, otro simula). Las instancias de una clase ya probada se verifican a 30 % del costo.
      terminos: [
        { driver: 'io_fisico', unitario: 0.1 },
        { driver: 'io_bus', unitario: 0.1 },
        { driver: 'puntos_interfaz', unitario: 0.03 },
        { driver: 'modulos_simples', unitario: 0.2, clon: 0.3, phi: 'modulos' },
        { driver: 'modulos_medios', unitario: 0.5, clon: 0.3, phi: 'modulos' },
        { driver: 'modulos_complejos', unitario: 1.5, clon: 0.3, phi: 'modulos' },
        { driver: 'fases_secuencia', unitario: 4, clon: 0.3, phi: 'secuencias' },
        { driver: 'unidades_batch', unitario: 6, clon: 0.3, phi: 'secuencias' },
        { driver: 'sif', unitario: 2, clon: 0.3, phi: 'modulos' },
        { driver: 'graficos_total', unitario: 1 },
        { driver: 'interfaces_terceros', unitario: 4 }
      ],
      factores: ['nivelDocumentacion'],
      plantillas: MAYORES
    },
    {
      id: 'PRU_FAT_GABINETE', nombre: 'Pruebas de gabinete en taller (continuidad, punto a punto, energizado)',
      lugar: 'TALLER', fase: 'PRUEBAS', rol: 'QA',
      terminos: [
        { driver: 'gabinetes', unitario: 4, clon: 0.8, phi: 'gabinetes' },
        { driver: 'terminaciones', unitario: 0.05 },
        { driver: 'terminaciones_integrar', unitario: 0.05 }
      ],
      factores: ['nivelDocumentacion'],
      plantillas: TODOS
    },

    // ───────────────────────── DOCUMENTACIÓN ─────────────────────────
    {
      id: 'DOC_HDS', nombre: 'Especificación de hardware / memoria descriptiva',
      lugar: 'OFICINA', fase: 'DOCUMENTACION', rol: 'IH', fijo: 16, fijoCondicional: true,
      terminos: [{ driver: 'gabinetes', unitario: 2, clon: 0.2, phi: 'gabinetes' }, { driver: 'nodos', unitario: 0.5 }],
      factores: ['nivelDocumentacion'], etiquetas: ['DOCUMENTOS'],
      plantillas: TODOS
    },
    {
      id: 'DOC_PROTOCOLOS', nombre: 'Protocolos de prueba (FAT / SAT / loop check)',
      lugar: 'OFICINA', fase: 'DOCUMENTACION', rol: 'IS', fijo: 12, fijoCondicional: true,
      // Un protocolo por típico; las instancias son filas de tabla (clon 0.2).
      terminos: [
        { driver: 'io_fisico', unitario: 0.05 },
        { driver: 'io_bus', unitario: 0.05 },
        { driver: 'puntos_interfaz', unitario: 0.01 },
        { driver: 'modulos_simples', unitario: 0.15, clon: 0.2, phi: 'modulos' },
        { driver: 'modulos_medios', unitario: 0.3, clon: 0.2, phi: 'modulos' },
        { driver: 'modulos_complejos', unitario: 0.8, clon: 0.2, phi: 'modulos' },
        { driver: 'fases_secuencia', unitario: 2, clon: 0.2, phi: 'secuencias' },
        { driver: 'unidades_batch', unitario: 3, clon: 0.2, phi: 'secuencias' },
        { driver: 'sif', unitario: 1, clon: 0.2, phi: 'modulos' },
        { driver: 'io_afectado', unitario: 0.05 },
        { driver: 'graficos_mod_total', unitario: 0.3 },
        { driver: 'modulos_mod_total', unitario: 0.5 }
      ],
      factores: ['nivelDocumentacion'], etiquetas: ['DOCUMENTOS'],
      plantillas: TODOS
    },
    {
      id: 'DOC_MANUALES', nombre: 'Manuales de operación y mantenimiento',
      lugar: 'OFICINA', fase: 'DOCUMENTACION', rol: 'DT', fijo: 24,
      terminos: [{ driver: 'graficos_total', unitario: 0.5 }, { driver: 'gabinetes', unitario: 1 }],
      factores: ['nivelDocumentacion'], etiquetas: ['DOCUMENTOS'],
      plantillas: MAYORES
    },
    {
      id: 'DOC_ASBUILT', nombre: 'Documentación as-built (actualización de planos y listados)',
      lugar: 'OFICINA', fase: 'DOCUMENTACION', rol: 'DT', fijo: 8, fijoCondicional: true,
      derivada: { porcentaje: 0.15, grupo: 'PLANOS', orden: 1 },
      factores: ['nivelDocumentacion'], etiquetas: ['DOCUMENTOS'],
      plantillas: TODOS
    },
    {
      id: 'DOC_CONTROL_DOCUMENTAL', nombre: 'Control documental (emisiones, revisiones, transmittals)',
      lugar: 'OFICINA', fase: 'DOCUMENTACION', rol: 'DT', fijo: 8, fijoCondicional: true,
      terminos: [{ driver: 'documentos_entregables', unitario: 4 }],
      factores: ['nivelDocumentacion'],
      plantillas: TODOS
    },

    // ───────────────────────── OTROS DE OFICINA ─────────────────────────
    {
      id: 'CAP_PREPARACION', nombre: 'Preparación de material de capacitación',
      lugar: 'OFICINA', fase: 'CAPACITACION', rol: 'INST',
      terminos: [{ driver: 'cursos_capacitacion', unitario: 8 }],
      factores: ['nivelDocumentacion'],
      plantillas: TODOS
    },
    {
      id: 'CUTOVER_PLANIFICACION', nombre: 'Planificación de cutover / ventana de parada',
      lugar: 'OFICINA', fase: 'DEFINICION', rol: 'LI', fijo: 24, fijoCondicional: true,
      terminos: [{ driver: 'gabinetes_afectados', unitario: 2 }],
      factores: ['complejidad', 'nivelDocumentacion'],
      plantillas: BROWN
    },
    {
      id: 'SOPORTE_GARANTIA', nombre: 'Soporte remoto post-entrega / garantía',
      lugar: 'OFICINA', fase: 'CIERRE', rol: 'IS', fijo: 16,
      terminos: [],
      factores: [],
      plantillas: TODOS
    },

    // ───────────────────────── TALLER ─────────────────────────
    {
      id: 'TAL_ARMADO_GABINETE', nombre: 'Armado de gabinete (estructura, placa, canaletas, montaje de componentes)',
      lugar: 'TALLER', fase: 'FABRICACION', rol: 'TT',
      terminos: [
        { driver: 'gabinetes', unitario: 8, clon: 0.85, phi: 'gabinetes' },
        { driver: 'componentes', unitario: 0.5 }
      ],
      factores: [],
      plantillas: TODOS
    },
    {
      id: 'TAL_CABLEADO', nombre: 'Cableado interno y marcación',
      lugar: 'TALLER', fase: 'FABRICACION', rol: 'TT',
      terminos: [{ driver: 'terminaciones', unitario: 0.15 }],
      factores: [],
      plantillas: TODOS
    },
    {
      id: 'TAL_INTEGRACION_MATERIALES', nombre: 'Integración de materiales en gabinete existente',
      lugar: 'TALLER', fase: 'FABRICACION', rol: 'TT', fijo: 4, fijoCondicional: true,
      terminos: [
        { driver: 'componentes_integrar', unitario: 0.75 },
        { driver: 'terminaciones_integrar', unitario: 0.15 }
      ],
      factores: [],
      plantillas: TODOS
    },
    {
      id: 'TAL_QC', nombre: 'Control de calidad de taller (inspección, torque, marcación)',
      lugar: 'TALLER', fase: 'FABRICACION', rol: 'QA',
      terminos: [
        { driver: 'gabinetes', unitario: 2 },
        { driver: 'terminaciones', unitario: 0.02 },
        { driver: 'componentes_integrar', unitario: 0.1 }
      ],
      factores: ['nivelDocumentacion'],
      plantillas: TODOS
    },
    {
      id: 'TAL_EMBALAJE', nombre: 'Embalaje y despacho',
      lugar: 'TALLER', fase: 'FABRICACION', rol: 'TT',
      terminos: [{ driver: 'gabinetes', unitario: 3 }],
      factores: [],
      plantillas: TODOS
    },

    // ───────────────────────── SITIO ─────────────────────────
    {
      id: 'SIT_SUPERVISION_MONTAJE', nombre: 'Supervisión de montaje e instalación',
      lugar: 'SITIO', fase: 'MONTAJE', rol: 'IC',
      // Si el usuario fija dias_supervision_montaje, se usa eso; si no, se deriva de gabinetes y nodos.
      terminos: [
        { driver: 'dias_supervision_montaje', unitario: 10 },
        { driver: 'gabinetes', unitario: 15, siCero: 'dias_supervision_montaje' },
        { driver: 'nodos', unitario: 5, siCero: 'dias_supervision_montaje' }
      ],
      factores: ['condicionesSitio', 'brownfield'],
      plantillas: TODOS
    },
    {
      id: 'SIT_PRECOM_ENERGIZACION', nombre: 'Pre-comisionamiento: verificación de instalación, energización, carga de configuración',
      lugar: 'SITIO', fase: 'PRECOM', rol: 'IC',
      terminos: [
        { driver: 'gabinetes', unitario: 6 },
        { driver: 'controladores', unitario: 4 },
        { driver: 'estaciones', unitario: 4 },
        { driver: 'switches', unitario: 2 }
      ],
      factores: ['condicionesSitio', 'brownfield'],
      plantillas: TODOS
    },
    {
      id: 'SIT_PRECOM_LAZOS', nombre: 'Pre-comisionamiento: pruebas de lazo (loop check) de señales alambradas',
      lugar: 'SITIO', fase: 'PRECOM', rol: 'TS',
      // horas-persona por canal, ya incluye el par campo/sala de control; modoLoopCheck=APOYA deja sólo la parte de sala
      terminos: [
        { driver: 'io_fisico', unitario: 0.9 },
        { driver: 'io_afectado', unitario: 0.6 }
      ],
      factores: ['condicionesSitio', 'brownfield', 'modoLoopCheck'],
      plantillas: TODOS
    },
    {
      id: 'SIT_PRECOM_REDES', nombre: 'Pre-comisionamiento: integración y verificación de equipos en red (FF, Profibus, Modbus, EtherNet/IP)',
      lugar: 'SITIO', fase: 'PRECOM', rol: 'IC',
      // trabajo del proveedor DCS aunque el loop check lo haga un tercero: direcciones, GSD/mapas, diagnóstico, estados y comandos
      terminos: [
        { driver: 'io_FF', unitario: 1.2 },
        { driver: 'io_PROFIBUS', unitario: 1.0 },
        { driver: 'interfaces_terceros', unitario: 6 },
        { driver: 'puntos_interfaz', unitario: 0.05 }
      ],
      factores: ['condicionesSitio', 'brownfield'],
      plantillas: TODOS
    },
    {
      id: 'SIT_CUTOVER', nombre: 'Cutover / re-conexión en ventana de parada',
      lugar: 'SITIO', fase: 'CUTOVER', rol: 'IC',
      terminos: [
        { driver: 'gabinetes_afectados', unitario: 8 },
        { driver: 'io_total', unitario: 0.05, plantillas: ['EXPANSION'] },
        { driver: 'io_total', unitario: 0.2, plantillas: ['MIGRACION'] }
      ],
      factores: ['condicionesSitio', 'brownfield'],
      plantillas: BROWN
    },
    {
      id: 'SIT_COM_FUNCIONAL', nombre: 'Comisionamiento: pruebas funcionales, sintonía y enclavamientos',
      lugar: 'SITIO', fase: 'COM', rol: 'IC', transferenciaFAT: true,
      terminos: [
        { driver: 'modulos_simples', unitario: 0.5 },
        { driver: 'modulos_medios', unitario: 1.5 },
        { driver: 'modulos_complejos', unitario: 4 },
        { driver: 'fases_secuencia', unitario: 8 },
        { driver: 'unidades_batch', unitario: 12 },
        { driver: 'sif', unitario: 6 },
        { driver: 'interfaces_terceros', unitario: 6 },
        { driver: 'modulos_mod_simples', unitario: 0.3 },
        { driver: 'modulos_mod_medios', unitario: 1 },
        { driver: 'modulos_mod_complejos', unitario: 3 },
        { driver: 'fases_mod', unitario: 5 }
      ],
      factores: ['complejidad', 'condicionesSitio', 'brownfield'],
      plantillas: TODOS
    },
    {
      id: 'SIT_SAT', nombre: 'SAT (pruebas de aceptación en sitio) presenciadas',
      lugar: 'SITIO', fase: 'SAT', rol: 'IC', fijo: 16, fijoCondicional: true, multiplicador: 2,
      // Presenciada: 2 personas. Instancias de clases ya aceptadas a 30 %.
      terminos: [
        { driver: 'io_fisico', unitario: 0.05 },
        { driver: 'io_bus', unitario: 0.05 },
        { driver: 'puntos_interfaz', unitario: 0.01 },
        { driver: 'modulos_simples', unitario: 0.1, clon: 0.3, phi: 'modulos' },
        { driver: 'modulos_medios', unitario: 0.2, clon: 0.3, phi: 'modulos' },
        { driver: 'modulos_complejos', unitario: 0.6, clon: 0.3, phi: 'modulos' },
        { driver: 'fases_secuencia', unitario: 2, clon: 0.3, phi: 'secuencias' },
        { driver: 'unidades_batch', unitario: 3, clon: 0.3, phi: 'secuencias' },
        { driver: 'sif', unitario: 1, clon: 0.3, phi: 'modulos' },
        { driver: 'graficos_total', unitario: 0.4 },
        { driver: 'io_afectado', unitario: 0.05 },
        { driver: 'graficos_mod_total', unitario: 0.3 },
        { driver: 'modulos_mod_total', unitario: 0.3 }
      ],
      factores: ['nivelDocumentacion', 'condicionesSitio'],
      plantillas: TODOS
    },
    {
      id: 'SIT_PEM_SOPORTE', nombre: 'Soporte a puesta en marcha (PEM) / arranque',
      lugar: 'SITIO', fase: 'PEM', rol: 'IC',
      terminos: [{ driver: 'dias_pem', unitario: 10 }], // 10 h-persona por día-persona (horasDiaSitio)
      factores: ['condicionesSitio'],
      plantillas: TODOS
    },
    {
      id: 'SIT_CAPACITACION', nombre: 'Dictado de capacitación en sitio',
      lugar: 'SITIO', fase: 'CAPACITACION', rol: 'INST',
      terminos: [{ driver: 'cursos_capacitacion', unitario: 8 }],
      factores: [],
      plantillas: TODOS
    },
    {
      id: 'SIT_REEMPLAZO_COMPONENTES', nombre: 'Reemplazo de componentes en sitio (tarjetas, controladores, estaciones)',
      lugar: 'SITIO', fase: 'SERVICIO', rol: 'IC',
      terminos: [
        { driver: 'reemplazo_tarjetas', unitario: 1.5 },
        { driver: 'reemplazo_controladores', unitario: 6 },
        { driver: 'reemplazo_estaciones', unitario: 10 }
      ],
      factores: ['condicionesSitio', 'brownfield'],
      plantillas: TODOS
    },
    {
      id: 'SIT_DESPLIEGUE_MODIFICACIONES', nombre: 'Descarga y prueba en sitio de modificaciones (pantallas, lógica)',
      lugar: 'SITIO', fase: 'SERVICIO', rol: 'IC', fijo: 4, fijoCondicional: true,
      terminos: [
        { driver: 'graficos_mod_total', unitario: 0.5 },
        { driver: 'modulos_mod_total', unitario: 1 }
      ],
      factores: ['condicionesSitio', 'brownfield'],
      plantillas: TODOS
    },
    {
      id: 'SIT_LIDER_TECNICO', nombre: 'Líder técnico en sitio (presencia durante el calendario de sitio)',
      lugar: 'SITIO', fase: 'LIDERAZGO', rol: 'LI',
      derivada: { calendario: 'liderTecnico', orden: 2 },
      plantillas: TODOS
    },
    {
      id: 'SIT_MOVILIZACION', nombre: 'Movilización / viajes (horas de traslado)',
      lugar: 'SITIO', fase: 'MOVILIZACION', rol: 'TS',
      derivada: { calendario: 'movilizacion', orden: 2 },
      plantillas: TODOS
    }
  ];

  const LUGARES = ['OFICINA', 'TALLER', 'SITIO'];

  return { ACTIVIDADES, DRIVERS, DRIVERS_DERIVADOS, LUGARES };
});
