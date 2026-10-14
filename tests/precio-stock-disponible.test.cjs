const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'..','App.jsx'),'utf8');
const section=(start,end)=>src.slice(src.indexOf(start),src.indexOf(end,src.indexOf(start)));
const originalSale={id:'V1',fecha:'2026-10-01',metodoPago:'efectivo',descPct:0,total:595,items:[{prodId:1,precioUnit:595,cantidad:1,subtotal:595}]};
const originalOrder={items:[{prodId:1,precio:595,cantidad:1}]};
const stored=new Map();const writes=[];const audits=[];let syncOk=true;
const ctx={Number,Math,JSON,inv:[{id:1,codigo:'DIA-01',nombre:'Diana Dress',precio:595,stock:2,stockInicial:3}],ventas:[originalSale],carrito:originalOrder.items,user:{nombre:'Prueba'},
 localStorage:{getItem:k=>stored.get(k)||null,setItem:(k,v)=>stored.set(k,v)},
 setInv:fn=>{ctx.inv=fn(ctx.inv);stored.set('th_inv',JSON.stringify(ctx.inv));},
 sbActualizarProductoPatch:async(id,campos)=>{writes.push({id,campos});return syncOk;},
 syncConRespaldo:async(tipo,payload,fn)=>{ctx.lastOp={tipo,payload};return fn();},
 logAudit:(tipo,data)=>audits.push({tipo,data}),
 ESCRITURA_NUBE_OK:true,
};
vm.createContext(ctx);
vm.runInContext(section('function validarPrecioDisponible(','function CambioPrecioTab('),ctx);
vm.runInContext(section('  async function handleEditarProducto(','  async function handleEliminarProducto('),ctx);
vm.runInContext(section('async function ejecutarOpOutbox(','async function procesarOutbox('),ctx);
vm.runInContext(section('function getManualDescPct(','// Retorna el total real de una venta'),ctx);
(async()=>{
 const before=JSON.stringify([ctx.ventas,ctx.carrito]);
 const result=await ctx.handleEditarProducto(1,{precio:650,_motivo:'Actualización autorizada'});
 assert.equal(result.ok,true);assert.equal(ctx.inv[0].precio,650);
 assert.equal(ctx.inv[0].stock,2);assert.equal(ctx.inv[0].stockInicial,3);
 assert.equal(JSON.stringify([ctx.ventas,ctx.carrito]),before);
 assert.equal(ctx.netItemSub(originalSale,originalSale.items[0]),595);
 assert.deepEqual(JSON.parse(JSON.stringify(writes[0])),{id:1,campos:{precio:650}});
 assert.equal(audits[0].data.precioAntes,595);assert.equal(audits[0].data.precioDespues,650);
 assert.equal(audits[0].data.alcance,'stock_disponible');
 ctx.inv[0].stock=0;
 assert.equal((await ctx.handleEditarProducto(1,{precio:700})).ok,false);
 assert.equal(writes.length,1);
 assert.equal((await ctx.handleEditarProducto(1,{nombre:'DIANA DRESS',precio:650})).ok,true);
 assert.equal('precio' in writes[1].campos,false);
 ctx.inv[0].stock=1;
 for(const precio of [0,0.001,-1,Infinity,NaN,'incorrecto']) assert.equal((await ctx.handleEditarProducto(1,{precio})).ok,false);
 syncOk=false;
 const pending=await ctx.handleEditarProducto(1,{precio:675});
 assert.equal(pending.ok,true);assert.equal(pending.synced,false);
 assert.equal(ctx.lastOp.tipo,'producto_patch');
 syncOk=true;
 await ctx.ejecutarOpOutbox({tipo:'producto_patch',payload:{prodId:1,precio:675}});
 assert.deepEqual(JSON.parse(JSON.stringify(writes.at(-1))),{id:1,campos:{precio:675}});
 assert.equal(JSON.stringify([ctx.ventas,ctx.carrito]),before);
 console.log('OK: venta y carrito a Bs 595 intactos; nuevo precio solo inventario; agotados bloqueados; auditoría y reintento sin stock ni prodId en columnas.');
})().catch(e=>{console.error(e);process.exitCode=1;});
