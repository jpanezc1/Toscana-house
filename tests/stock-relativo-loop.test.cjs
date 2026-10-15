// La caja mueve stock como diferencia (no como número final) para convivir con Loop.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync(require('node:path').join(__dirname,'..','App.jsx'),'utf8');
const section=(start,end)=>src.slice(src.indexOf(start),src.indexOf(end,src.indexOf(start)));
const rpcs=[];const updates=[];let rpcError=null;let fila={stock:5,stock_inicial:8};
const fakeDb={
  rpc:async(nombre,args)=>{rpcs.push({nombre,args});return {error:rpcError};},
  from:()=>({
    select:()=>({eq:()=>({maybeSingle:async()=>({data:fila,error:null})})}),
    update:patch=>({eq:async()=>{updates.push(patch);return {error:null};}}),
  }),
};
const ctx={Math,Number,JSON,Date,console:{warn(){}},ESCRITURA_NUBE_OK:true,getSupabase:async()=>fakeDb,
  syncConRespaldo:async(tipo,payload,fn)=>{ctx.ultima={tipo,payload};return fn();}};
vm.createContext(ctx);
vm.runInContext(section('async function sbMoverStock(','async function sbActualizarProductoPatch('),ctx);
vm.runInContext(section('function moverStockNube(','async function syncConRespaldo('),ctx);
vm.runInContext(section('async function ejecutarOpOutbox(','async function procesarOutbox('),ctx);
(async()=>{
  // 1. con la función en la base: viaja la diferencia y una referencia
  assert.equal(await ctx.moverStockNube(7,-1,4),true);
  assert.equal(ctx.ultima.tipo,'stock_delta');
  assert.equal(ctx.ultima.payload.delta,-1);
  assert.equal(rpcs[0].nombre,'th_mover_stock');
  assert.equal(rpcs[0].args.p_delta,-1);
  assert.ok(String(rpcs[0].args.p_ref).startsWith('mv-'));
  // 2. el reintento desde la cola usa la MISMA referencia
  await ctx.ejecutarOpOutbox({tipo:'stock_delta',payload:ctx.ultima.payload});
  assert.equal(rpcs[1].args.p_ref,rpcs[0].args.p_ref);
  // 3. reponer mueve también el stock inicial
  await ctx.moverStockNube(7,3,8,3,11);
  assert.equal(rpcs[2].args.p_delta_inicial,3);
  assert.equal(ctx.ultima.payload.stock_inicial,11);
  // 4. base sin el SQL nuevo: resta sobre el valor ACTUAL de la nube, no el del navegador
  rpcError={code:'PGRST202',message:'Could not find the function public.th_mover_stock'};
  assert.equal(await ctx.sbMoverStock(7,-2,0,'x'),true);
  assert.deepEqual(JSON.parse(JSON.stringify(updates[0])),{stock:3});
  // 5. otro error: devuelve false para que quede en la cola
  rpcError={code:'500',message:'timeout'};
  assert.equal(await ctx.sbMoverStock(7,-1,0,'y'),false);
  // 6. ya no quedan escrituras de número final en la caja (solo cargas y su reversión)
  const absolutos=(src.match(/syncConRespaldo\("stock",/g)||[]).length;
  assert.equal(absolutos,2);
  console.log('stock relativo: OK');
})().catch(e=>{console.error(e);process.exit(1);});
