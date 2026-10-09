const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'App.jsx'), 'utf8');
const inicio = src.indexOf('function datosGraficasMensuales(');
const fin = src.indexOf('function GraficaLineasSVG(', inicio);
assert.ok(inicio >= 0 && fin > inicio, 'No se encontró el cálculo de las gráficas');

const sandbox = {
  hoy: () => '2026-10-09',
  getDisplayTotal: v => v.total,
  ventaBloqueada: id => String(id).startsWith('TEST'),
};
vm.createContext(sandbox);
vm.runInContext(src.slice(inicio, fin), sandbox);
const calcular = sandbox.datosGraficasMensuales;

const ventas = [
  {id:'1', fecha:'2026-10-01', total:100, items:[{marcaId:1,marcaNombre:'Ramona',neto:100}]},
  {id:'2', fecha:'2026-10-09', total:50.5, items:[{marcaId:2,marcaNombre:'Glowphoria',neto:50.5}]},
  {id:'3', fecha:'2026-10-10', total:99, items:[{marcaId:1,marcaNombre:'Ramona',neto:99}]},
  {id:'4', fecha:'2026-09-01', total:80, items:[{marcaId:1,marcaNombre:'Ramona',neto:80}]},
  {id:'5', fecha:'2026-09-09', total:20, items:[{marcaId:2,marcaNombre:'Glowphoria',neto:20}]},
  {id:'6', fecha:'2026-08-01', total:10, items:[{marcaId:1,marcaNombre:'Ramona',neto:10}]},
  {id:'7', fecha:'2026-10-08', total:200, anulada:true},
  {id:'TEST8', fecha:'2026-10-08', total:300},
];

const actual = calcular(ventas, 9, 2026, 3100, '2026-10-09');
assert.equal(actual.diasVisibles, 9);
assert.equal(actual.vendido, 150.5);
assert.equal(actual.acumulado.length, 10);
assert.equal(actual.metaDiaria.length, 32);
assert.equal(actual.metaDiaria[9], 900);
assert.equal(actual.diarioActual[9], null, 'Los días futuros no deben dibujarse como ventas reales');
assert.equal(actual.comparables, 9);
assert.equal(actual.previoComparable, 100);
assert.equal(actual.actualComparable, 150.5);
assert.equal(actual.variacion, 50.5);

const historico = calcular(ventas, 8, 2026, 0, '2026-10-09');
assert.equal(historico.diasVisibles, 30);
assert.equal(historico.vendido, 100);
assert.equal(historico.comparables, 30);
assert.equal(historico.metaDiaria.length, 0);

const futuro = calcular(ventas, 10, 2026, 0, '2026-10-09');
assert.equal(futuro.diasVisibles, 0);
assert.deepEqual(JSON.parse(JSON.stringify(futuro.acumulado)), [0]);

const enero = calcular([
  {id:'9',fecha:'2025-12-03',total:42},
  {id:'10',fecha:'2026-01-03',total:50},
], 0, 2026, 0, '2026-01-04');
assert.equal(enero.comparables, 4);
assert.equal(enero.previoComparable, 42);
assert.equal(enero.actualComparable, 50);

console.log('OK: gráficas mensuales, meta, comparación justa y cambio de año');
