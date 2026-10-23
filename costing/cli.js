#!/usr/bin/env node
/**
 * cli.js — Ejecuta el modelo sobre un archivo JSON de entrada.
 *   node costing/cli.js costing/ejemplos/planta-nueva.json [--json] [--optimizar]
 */
const fs = require('fs');
const path = require('path');
const motor = require('./motor.js');

const args = process.argv.slice(2);
const archivo = args.find(a => !a.startsWith('--'));
if (!archivo) {
  console.error('Uso: node costing/cli.js <entrada.json> [--json] [--optimizar]');
  process.exit(1);
}
const entrada = JSON.parse(fs.readFileSync(path.resolve(archivo), 'utf8'));
const tarifas = entrada.tarifas;
let resultado, costo;
if (args.includes('--optimizar')) {
  const opt = motor.optimizarCuadrillas(entrada, tarifas);
  resultado = opt.resultado; costo = opt.costo;
  console.error('Cuadrillas óptimas por fase: ' + JSON.stringify(opt.personasPorFase));
} else {
  resultado = motor.calcular(entrada);
  costo = tarifas ? motor.costear(resultado, tarifas) : null;
}
if (args.includes('--json')) console.log(JSON.stringify({ resultado, costo }, null, 2));
else console.log(motor.reporteTexto(resultado, costo));
