const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'App.jsx'), 'utf8');
const inicio = src.indexOf('function codigoExistenteEnDescripcion(');
const fin = src.indexOf('function ImportarExcelModal(', inicio);
assert.ok(inicio >= 0 && fin > inicio, 'No se encontró la protección de códigos existentes');
const sandbox = {
  extraerTalla: d => (String(d||'').match(/TALLA:\s*([^·\n]+)/i)||[])[1]?.trim()||'',
  extraerColor: d => (String(d||'').match(/COLOR:\s*([^·\n]+)/i)||[])[1]?.trim()||'',
  extraerTallaCodigo: () => '',
  tallaComparable: t => String(t||'').toUpperCase().replace(/\s+/g,''),
};
vm.createContext(sandbox);
vm.runInContext(src.slice(inicio, fin), sandbox);
const buscar = sandbox.codigoExistenteEnDescripcion;
const inventario = [
  {codigo:'B-0165',nombre:'PULSERAS',marcaId:9,precio:165,descripcion:'',subcat:''},
  {codigo:'OTR-0165',nombre:'PULSERAS',marcaId:10,precio:165,descripcion:'',subcat:''},
];
assert.equal(buscar('PULSERAS · B-0165',9,165,'TALLA UNICA','',inventario)?.codigo,'B-0165');
assert.equal(buscar('PULSERAS · B-0165',10,165,'TALLA UNICA','',inventario),null,
  'No se puede tomar el código de otra marca');
assert.equal(buscar('PULSERAS · B-0165',9,180,'TALLA UNICA','',inventario),null,
  'Un precio distinto requiere revisión, no fusión');
assert.equal(buscar('COLLARES · B-0165',9,165,'TALLA UNICA','',inventario),null,
  'El código en el texto no basta si cambia el producto');
assert.equal(buscar('PULSERAS · B-01650',9,165,'TALLA UNICA','',inventario),null,
  'No debe confundir códigos parciales');

console.log('OK: el código histórico embebido conserva su identidad sin unir otros productos');
