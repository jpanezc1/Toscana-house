const assert=require('node:assert/strict');
(async()=>{
  const {conciliarRetirosVerificacion:conciliar}=await import('../verificacion-retiros.mjs');
  const a={id:'AUD-2026-10-1793132407204',valorFuga:6170,detalle:[
    {codigo:'RAM-39-021',marcaId:2,sistema:1,contado:0,precio:590},
    {codigo:'RAM-40-010',marcaId:2,sistema:1,contado:0,precio:450},
    {codigo:'RAM-38-08336',marcaId:2,sistema:1,contado:0,precio:450}]};
  const r={id:'RET-1793132485153-0',codigo:'RAM-39-021',marcaId:2,cantidad:1};
  const b=conciliar(a,[r]);
  assert.equal(b.detalle[0].estado,'OK');
  assert.equal(b.detalle[0].contado,0);
  assert.equal(b.faltantes,2); assert.equal(b.valorFuga,900);
  assert.deepEqual(conciliar(b,[r]),b,'No descontar dos veces');
  assert.deepEqual(conciliar(a,[r,r]),b,'No duplicar retiros');
  assert.equal(conciliar(b,[{...r,anulada:true}]).valorFuga,1490);
  assert.equal(conciliar(a,[{...r,id:'RET-1793132000000-0'}]).valorFuga,1490,'Retiro anterior ya incluido en base');
  assert.equal(conciliar(a,[{...r,marcaId:3}]).valorFuga,1490);
  assert.equal(conciliar(a,[{...r,cantidad:9}]).detalle[0].estado,'OK','No crear sobrante');
  assert.equal(a.valorFuga,6170,'No mutar el historial original');
  console.log('OK conciliación retiros, idempotencia, anulación, marcas y totales');
})().catch(e=>{console.error(e);process.exit(1)});
