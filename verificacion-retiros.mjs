export function fechaRetiroMs(r) {
  const ts = String(r.id || '').match(/^RET-(\d{13})(?:-|$)/)?.[1];
  return ts ? Number(ts) : Date.parse(r.created_at || '') || 0;
}

export function resumirVerificacion(a) {
  const detalle = a.detalle || [];
  return {...a, totalProductos:detalle.length,
    ok:detalle.filter(d=>d.estado==='OK').length,
    faltantes:detalle.filter(d=>d.estado==='FALTANTE').length,
    sobrantes:detalle.filter(d=>d.estado==='SOBRANTE').length,
    valorFuga:detalle.reduce((s,d)=>s+Math.max(0,-Number(d.diferencia||0))*Number(d.precio||0),0),
    valorSobrante:detalle.reduce((s,d)=>s+Math.max(0,Number(d.diferencia||0))*Number(d.precio||0),0)};
}

// Conserva el conteo físico y la base original. Los retiros posteriores
// justifican unidades pendientes; nunca generan sobrantes artificiales.
export function conciliarRetirosVerificacion(a, retiros=[]) {
  const cierre = Number(String(a.id||'').match(/-(\d{13})$/)?.[1]) || 0;
  const detalle = (a.detalle||[]).map(d=>{
    const base = Number(d.sistemaAntesRetiros ?? d.sistema) || 0;
    const desde = Date.parse(d.ultimoAgregoTs || d.agregadoTs || '') || cierre;
    const vistos = new Set();
    const posteriores = retiros.filter(r=>{
      if(!desde || r.anulada || !r.id || vistos.has(r.id) || fechaRetiroMs(r)<=desde) return false;
      if(String(r.codigo||'').trim().toUpperCase()!==String(d.codigo||'').trim().toUpperCase()) return false;
      const marca=r.marcaId ?? r.marca_id;
      if(marca!=null && d.marcaId!=null && String(marca)!==String(d.marcaId)) return false;
      vistos.add(r.id); return true;
    });
    const unidades = posteriores.reduce((s,r)=>s+Math.max(0,Number(r.cantidad)||0),0);
    const ajuste = Math.min(Math.max(0,base-Number(d.contado||0)),unidades);
    const sistema=base-ajuste, diferencia=Number(d.contado||0)-sistema;
    return {...d,sistemaAntesRetiros:base,sistema,diferencia,
      estado:diferencia===0?'OK':diferencia>0?'SOBRANTE':'FALTANTE',
      retirosAplicados:ajuste,retirosReferencia:posteriores.map(r=>r.id)};
  });
  return resumirVerificacion({...a,detalle});
}
