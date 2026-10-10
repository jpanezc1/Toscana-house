const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'App.jsx'), 'utf8');
const inicio = src.indexOf('function calendarioMesSinDomingos(');
const fin = src.indexOf('// Convierte fecha (', inicio);
assert.ok(inicio >= 0 && fin > inicio, 'No se encontró el calendario comercial');
const sandbox = {hoy: () => '2026-10-09'};
vm.createContext(sandbox);
vm.runInContext(src.slice(inicio, fin), sandbox);
const calendario = sandbox.calendarioMesSinDomingos;
const proyectar = sandbox.proyeccionVentasSinDomingos;

const octubre = calendario(2026, 9, '2026-10-09');
assert.equal(octubre.diasCalendario, 31);
assert.equal(octubre.diasVentaTotal, 27);
assert.equal(octubre.diasVentaTranscurridos, 8);
assert.equal(octubre.diasVentaRestantes, 19);
assert.equal(octubre.diasVentaDisponibles, 20, 'El día de hoy todavía está disponible');
assert.equal(octubre.acumulados[4], octubre.acumulados[3], 'El domingo no avanza la meta');
assert.equal(proyectar(800, 2026, 9, '2026-10-09').proyeccion, 2700);
assert.equal(proyectar(800, 2026, 9, '2026-10-09').promedio, 100);

const sabado = calendario(2026, 9, '2026-10-10');
const domingo = calendario(2026, 9, '2026-10-11');
assert.equal(domingo.diasVentaTranscurridos, sabado.diasVentaTranscurridos);
assert.equal(domingo.diasVentaDisponibles, domingo.diasVentaRestantes);
assert.equal(domingo.hoyEsDiaVenta, false);
assert.equal(proyectar(900, 2026, 9, '2026-10-11').proyeccion, 2700);

const septiembre = proyectar(5000, 2026, 8, '2026-10-09');
assert.equal(septiembre.estado, 'cerrado');
assert.equal(septiembre.diasVentaTotal, 26);
assert.equal(septiembre.proyeccion, 5000, 'Un mes cerrado muestra el cierre real');
assert.equal(septiembre.diasVentaRestantes, 0);
assert.equal(septiembre.progreso, 100);

const noviembre = proyectar(0, 2026, 10, '2026-10-09');
assert.equal(noviembre.estado, 'futuro');
assert.equal(noviembre.diasVentaTranscurridos, 0);
assert.equal(noviembre.proyeccion, 0);

console.log('OK: proyección, promedio, meta y días restantes sin domingos');
