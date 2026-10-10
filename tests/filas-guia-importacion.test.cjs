const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'App.jsx'), 'utf8');
const inicio = src.indexOf('function esFilaGuiaImportacion(');
const fin = src.indexOf('function codigoExistenteEnDescripcion(', inicio);
assert.ok(inicio >= 0 && fin > inicio, 'No se encontró el filtro de filas de guía');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(src.slice(inicio, fin), sandbox);
const esGuia = sandbox.esFilaGuiaImportacion;

const prendas = [
  ['RAMONA','BIRKENSTOCK BLACK','ESTILO SUECO CON PLANTILLA DE CORCHO','NEGRO',39,1,450],
  ['RAMONA','BIRKENSTOCK BLACK','ESTILO SUECO CON PLANTILLA DE CORCHO','NEGRO',40,1,450],
  ['RAMONA','ARIZONA MEN BLACK','ESTILO SANDALIA, PLANTILLA DE CORCHO','NEGRO',44,1,470],
];
for(const fila of prendas){
  assert.equal(esGuia(fila,true),false,`No debe omitir ${fila[1]} por decir plantilla de corcho`);
}
assert.equal(esGuia(['PLANTILLA','Copiar los productos aquí']),true);
assert.equal(esGuia(['Ejemplo:','MARCA','PRODUCTO']),true);
assert.equal(esGuia(['No ingresar datos en esta fila']),true);
assert.equal(esGuia(['RAMONA','Producto ejemplo','COLOR ROJO'],true),false,
  'Una marca válida nunca debe descartarse por palabras en la descripción');

console.log('OK: instrucciones excluidas sin perder prendas que mencionan plantilla');
