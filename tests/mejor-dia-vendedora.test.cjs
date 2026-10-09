const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const src = fs.readFileSync(require('node:path').join(__dirname, '..', 'App.jsx'), 'utf8');
const inicio = src.indexOf('function normalizarNombreVendedor(');
const fin = src.indexOf('function MetasCajaInicio(', inicio);
assert.ok(inicio >= 0 && fin > inicio, 'No se encontró el cálculo de la tarjeta');

const sandbox = {
  getDisplayTotal: v => v.total,
  ventaBloqueada: id => String(id).startsWith('TEST'),
};
vm.createContext(sandbox);
vm.runInContext(src.slice(inicio, fin), sandbox);
const mejor = sandbox.mejorDiaVendedora;

const ventas = [
  {id:'1',fecha:'2026-10-01',vendedor:'DANIA PEÑA H',total:200},
  {id:'2',fecha:'2026-10-01',vendedor:'dania ',total:150},
  {id:'3',fecha:'2026-10-02',vendedor:'DANIA PEÑA H',total:300},
  {id:'4',fecha:'2026-10-01',vendedor:'Alejandra Pardo',total:999},
  {id:'5',fecha:'2026-10-01',vendedor:'DANIA PEÑA H',total:999,anulada:true},
  {id:'TEST6',fecha:'2026-10-01',vendedor:'DANIA PEÑA H',total:999},
  {id:'7',fecha:'2026-10-01',vendedor:'DANIA PEÑA H',total:0.1},
];
assert.deepEqual(JSON.parse(JSON.stringify(mejor(ventas,{usuario:'daniah',nombre:'DANIA PEÑA H'}))),
  {fecha:'2026-10-01',total:350.1,ventas:3});
assert.deepEqual(JSON.parse(JSON.stringify(mejor(ventas,{usuario:'alejandrap',nombre:'Alejandra Pardo'}))),
  {fecha:'2026-10-01',total:999,ventas:1});
assert.equal(mejor(ventas,{usuario:'nadia',nombre:'Nadia'}),null);
assert.equal(mejor(ventas,{usuario:'',nombre:''}),null);
console.log('OK: récord personal, alias histórico y exclusiones');
