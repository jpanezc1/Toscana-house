const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'App.jsx'), 'utf8');
const inicio = src.indexOf('function resumenVentasVendedoras(');
const fin = src.indexOf('function RendimientoVendedoras(', inicio);
assert.ok(inicio >= 0 && fin > inicio, 'No se encontró el cálculo de productividad');
const sandbox = {
  normalizarNombreVendedor: n => String(n||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .toLowerCase().replace(/\s+/g,' ').trim(),
  getDisplayTotal: v => v.total,
  ventaBloqueada: id => String(id).startsWith('TEST'),
};
vm.createContext(sandbox);
vm.runInContext(src.slice(inicio, fin), sandbox);
const resumen = sandbox.resumenVentasVendedoras;
const historial = sandbox.historialProductividadVendedoras;

const cajeras = [
  {usuario:'alejandrap',nombre:'Alejandra Pardo',rol:'caja',estado:'activo'},
  {usuario:'daniah',nombre:'DANIA PEÑA H',rol:'caja',estado:'activo'},
  {usuario:'nadia',nombre:'Nadia',rol:'caja',estado:'activo'},
  {usuario:'admin',nombre:'Carolina',rol:'admin',estado:'activo'},
];
const ventas = [
  {id:'1',fecha:'2026-10-09',vendedor:'Alejandra Pardo',total:200.25,cajaTurnoId:'turno-a'},
  {id:'2',fecha:'2026-10-09',vendedor:'Nadia',total:100,cajaTurnoId:'turno-a'},
  {id:'3',fecha:'2026-10-08',vendedor:'Dania',total:50.5,cajaTurnoId:'turno-b'},
  {id:'4',fecha:'2026-10-09',vendedor:'Carolina',total:40},
  {id:'5',fecha:'2026-10-09',vendedor:null,total:10},
  {id:'6',fecha:'2026-09-30',vendedor:'Nadia',total:500},
  {id:'7',fecha:'2026-10-09',vendedor:'Nadia',total:999,anulada:true},
  {id:'TEST8',fecha:'2026-10-09',vendedor:'Nadia',total:999},
  {id:'9',fecha:'2026-10-10',vendedor:'Nadia',total:999},
];
const r = resumen(ventas,cajeras,'2026-10-09',9,2026);
const porUsuario = Object.fromEntries(r.filas.map(f=>[f.usuario, f]));
assert.equal(porUsuario.alejandrap.diaCentavos,20025);
assert.equal(porUsuario.alejandrap.diaVentas,1);
assert.equal(porUsuario.nadia.diaCentavos,10000);
assert.equal(porUsuario.nadia.mesCentavos,10000);
assert.equal(porUsuario.daniah.diaCentavos,0);
assert.equal(porUsuario.daniah.mesCentavos,5050);
assert.equal(porUsuario.daniah.mesVentas,1);
assert.equal(r.otras.diaCentavos,5000);
assert.equal(r.otras.diaVentas,2);
assert.equal(r.filas.reduce((n,f)=>n+f.diaCentavos,r.otras.diaCentavos),35025);
assert.equal(r.filas.reduce((n,f)=>n+f.mesCentavos,r.otras.mesCentavos),40075);

const septiembre = resumen(ventas,cajeras,'2026-10-09',8,2026);
assert.equal(septiembre.filas.find(f=>f.usuario==='nadia').mesCentavos,50000);
assert.equal(septiembre.filas.find(f=>f.usuario==='nadia').diaCentavos,10000,
  'La tarjeta diaria no debe cambiar cuando se selecciona otro mes');

const historia = historial(ventas,cajeras,'2026-10-09');
assert.deepEqual(Array.from(historia,x=>x.periodo),['2026-10','2026-09']);
assert.equal(historia[0].filas.find(f=>f.usuario==='alejandrap').puesto,1);
assert.equal(historia[0].filas.find(f=>f.usuario==='nadia').puesto,2);
assert.equal(historia[0].filas.find(f=>f.usuario==='daniah').puesto,3);
assert.equal(historia[0].totalTienda,40075);
assert.equal(historia[1].filas.find(f=>f.usuario==='nadia').puesto,1);
assert.equal(historia[1].filas.find(f=>f.usuario==='alejandrap').puesto,null);
assert.equal(historia[1].totalTienda,50000);

const empate = historial([
  {id:'T1',fecha:'2026-10-09',vendedor:'Nadia',total:100},
  {id:'T2',fecha:'2026-10-09',vendedor:'Alejandra Pardo',total:100},
],cajeras,'2026-10-09')[0];
assert.equal(empate.filas.find(f=>f.usuario==='nadia').puesto,1);
assert.equal(empate.filas.find(f=>f.usuario==='alejandrap').puesto,1);
assert.equal(empate.filas.find(f=>f.usuario==='daniah').puesto,null);

console.log('OK: ventas por vendedora, historial mensual, ranking, conciliación y exclusiones');
