const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const src=fs.readFileSync('App.jsx','utf8');
function extract(name){const start=src.indexOf('function '+name+'(');assert(start>=0);let p=src.indexOf('{',start),n=1;for(let i=p+1;i<src.length;i++){if(src[i]==='{')n++;if(src[i]==='}'&&!--n)return src.slice(start,i+1);}}
function context(gastos){const c={leerCfgLiq:()=>({pctTarjeta:2,pctComision:3,alquiler:100}),leerGastosLiq:()=>gastos,netItemSub:(v,i)=>i.subtotal,getDisplayTotal:v=>v.total,$1:n=>'Bs '+n.toFixed(2)};vm.createContext(c);['esReintegroLiq','etiquetaAjusteLiq','importeAjusteLiq','parseMixtoXls','calcLiqMarca'].forEach(n=>vm.runInContext(extract(n),c));return c;}
const venta=[{total:1000,metodoPago:'tarjeta',items:[{marcaId:7,subtotal:1000}]}];
test('gastos históricos mantienen el neto',()=>{assert.equal(context([{monto:50}]).calcLiqMarca(venta,7,'2026-10').neto,800.6);});
test('reintegro suma sin comisión adicional ni alterar ventas',()=>{const c=context([{monto:50},{tipo:'reintegro',desc:'Garantía',monto:-500}]);const r=c.calcLiqMarca(venta,7,'2026-10');assert.equal(r.neto,1300.6);assert.equal(r.bruto,1000);assert.equal(r.comision,29.4);});
test('varios reintegros y mes sin ventas',()=>{assert.equal(context([{monto:-500},{monto:-25},{monto:10}]).calcLiqMarca([],7,'2026-10').neto,415);});
test('signo y etiqueta coherentes en exportaciones',()=>{const c=context([]),r={tipo:'reintegro',monto:-500,desc:'Garantía'};assert.equal(c.etiquetaAjusteLiq(r),'+ Reintegro: Garantía');assert.equal(c.importeAjusteLiq(r),'+Bs 500.00');assert.equal(c.importeAjusteLiq({monto:10}),'-Bs 10.00');});
test('formularios y exportaciones incluyen trazabilidad y validaciones',()=>{assert(src.includes('user={user}\n        marcaId={mLiq}'));assert(src.includes('!Number.isFinite(monto)||monto<=0'));assert(src.includes('REINTEGRO_LIQUIDACION'));assert(!src.includes('`-${$1(Number(g.monto)||0)}`'));assert(!src.includes('if(totalGastos>0)'));});
