import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...corsHeaders,"Content-Type":"application/json"},
});
const str=(value:unknown,max=300)=>String(value??"").trim().slice(0,max);
const uuidOk=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({ok:false,error:"Método no permitido"},405);

  const url=Deno.env.get("SUPABASE_URL")!;
  const anonKey=Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const apiKey=Deno.env.get("CUCU_API_KEY")||"";
  const endpoint=(Deno.env.get("CUCU_ENDPOINT")||"https://sandbox.cucu.bo/api/v1/invoices").replace(/\/$/,"");
  const pointOfSaleId=Deno.env.get("CUCU_POINT_OF_SALE_ID")||"";
  const actividad=Deno.env.get("CUCU_CODIGO_ACTIVIDAD")||"470000";
  const productoSin=Deno.env.get("CUCU_CODIGO_PRODUCTO_SIN")||"58311";
  const unitMeasure=Number(Deno.env.get("CUCU_UNIDAD_MEDIDA")||58);
  const anonymousDocument=Deno.env.get("CUCU_DOCUMENTO_ANONIMO")||"99001";

  try{
    const authorization=req.headers.get("Authorization")||"";
    const userClient=createClient(url,anonKey,{global:{headers:{Authorization:authorization}}});
    const {data:{user},error:userError}=await userClient.auth.getUser();
    if(userError||!user) return json({ok:false,error:"Sesión inválida"},401);

    const admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:caller}=await admin.from("usuarios").select("usuario,nombre,rol,estado").eq("auth_id",user.id).maybeSingle();
    if(!caller||caller.estado!=="activo"||!["admin","caja"].includes(caller.rol))
      return json({ok:false,error:"Rol no autorizado para facturación"},403);

    const body=await req.json();
    const action=str(body.action,30);
    if(action==="health") return json({ok:true,configured:!!apiKey&&!!pointOfSaleId,provider:"CUCU",environment:endpoint.includes("sandbox")?"sandbox":"production"});

    const ventaId=str(body.ventaId,120);
    if(!ventaId) return json({ok:false,error:"Venta requerida"},400);

    if(action==="get"){
      const {data:fac}=await admin.from("facturas_venta").select("*").eq("venta_id",ventaId)
        .order("emitida_at",{ascending:false}).limit(1).maybeSingle();
      if(!fac) return json({ok:true,factura:null});
      if(!["emitida","anulada"].includes(fac.estado)){
        const revision=["revision","revision_anulacion"].includes(fac.estado);
        return json({
          ok:true,factura:null,estado:fac.estado,
          requiereRevision:revision,
          mensaje:revision
            ? "La factura quedó en revisión y está bloqueada contra operaciones duplicadas."
            : "La operación de factura todavía está siendo procesada.",
        });
      }
      return json({ok:true,factura:{
        cuf:fac.cuf||"",numero:fac.numero||"",qrUrl:fac.qr_url||"",pdf:fac.pdf_url||"",
        nitComprador:Number(fac.nit_comprador)||0,nombreComprador:fac.nombre_comprador||"Sin Nombre",
        telefono:fac.telefono||"",anulada:fac.estado==="anulada",estado:fac.estado,
      }});
    }

    const operationId=str(body.operationId,40);
    if(!uuidOk(operationId)) return json({ok:false,error:"operationId inválido"},400);

    if(action==="void"){
      const {data:fac}=await admin.from("facturas_venta").select("*").eq("venta_id",ventaId)
        .neq("estado","anulada").order("emitida_at",{ascending:false}).limit(1).maybeSingle();
      if(!fac){
        const {data:old}=await admin.from("facturas_venta").select("id").eq("venta_id",ventaId).eq("estado","anulada").limit(1).maybeSingle();
        return old?json({ok:true,replay:true}):json({ok:false,error:"Factura activa no encontrada"},404);
      }
      if(["anulacion_procesando","revision_anulacion","revision"].includes(fac.estado))
        return json({ok:false,error:"La factura tiene una operación incierta y está bloqueada para revisión.",code:"INVOICE_REVIEW_REQUIRED"},409);

      const claimMetadata={...(fac.metadata||{}),voidOperationId:operationId,voidBy:caller.usuario,voidReservedAt:new Date().toISOString()};
      const {data:claimed,error:claimError}=await admin.from("facturas_venta").update({
        estado:"anulacion_procesando",metadata:claimMetadata,
      }).eq("id",fac.id).eq("estado",fac.estado).select("id").maybeSingle();
      if(claimError) throw claimError;
      if(!claimed) return json({ok:false,error:"Otra anulación ya está procesando esta factura",code:"OPERATION_IN_PROGRESS"},409);

      if(fac.proveedor==="CUCU"){
        if(!apiKey){
          await admin.from("facturas_venta").update({estado:"emitida",metadata:{...claimMetadata,voidError:"CUCU_API_KEY ausente"}}).eq("id",fac.id);
          return json({ok:false,error:"CUCU_API_KEY no está configurada en el servidor"},503);
        }
        let providerId=fac.provider_invoice_id;
        if(!providerId&&fac.cuf){
          try{
            const lookup=await fetch(`${endpoint}/cuf/${encodeURIComponent(fac.cuf)}`,{
              headers:{"X-API-Key":apiKey},signal:AbortSignal.timeout(15000),
            });
            if(lookup.ok){
              const lookupBody=await lookup.json();
              providerId=lookupBody?.data?.id||"";
              if(providerId) await admin.from("facturas_venta").update({provider_invoice_id:providerId}).eq("id",fac.id);
            }
          }catch(error){
            await admin.from("facturas_venta").update({
              estado:"revision_anulacion",metadata:{...claimMetadata,voidError:String(error)},
            }).eq("id",fac.id);
            return json({ok:false,error:"No se pudo verificar la factura en CUCU. Quedó bloqueada para revisión.",code:"INVOICE_REVIEW_REQUIRED"},502);
          }
        }
        if(!providerId){
          await admin.from("facturas_venta").update({estado:"emitida",metadata:{...claimMetadata,voidError:"ID CUCU no resuelto"}}).eq("id",fac.id);
          return json({ok:false,error:"No se pudo resolver el ID CUCU de la factura"},409);
        }
        const motivo=Number(body.motivo)||1;
        let response:Response;
        try{
          response=await fetch(`${endpoint}/${encodeURIComponent(providerId)}/cancel?motivo=${Math.min(4,Math.max(1,motivo))}`,{
            method:"POST",headers:{"X-API-Key":apiKey,"Content-Type":"application/json"},
            signal:AbortSignal.timeout(15000),
          });
        }catch(error){
          await admin.from("facturas_venta").update({
            estado:"revision_anulacion",metadata:{...claimMetadata,voidError:String(error)},
          }).eq("id",fac.id);
          return json({ok:false,error:"Respuesta de anulación CUCU incierta. Quedó bloqueada para revisión; no se repetirá.",code:"INVOICE_REVIEW_REQUIRED"},502);
        }
        if(!response.ok){
          const detail=(await response.text()).slice(0,300);
          await admin.from("facturas_venta").update({
            estado:"emitida",metadata:{...claimMetadata,voidRejected:`CUCU ${response.status}: ${detail}`},
          }).eq("id",fac.id);
          return json({ok:false,error:`CUCU ${response.status}: ${detail}`},502);
        }
      }
      const {error:updateError}=await admin.from("facturas_venta").update({
        estado:"anulada",anulada_at:new Date().toISOString(),
        metadata:{...claimMetadata,voidConfirmedAt:new Date().toISOString()},
      }).eq("id",fac.id);
      if(updateError) throw updateError;
      await admin.from("audit_log").insert({
        id:`EVT_${crypto.randomUUID().replaceAll("-","")}`,ts:Date.now(),tipo:"FACTURA_ANULADA",
        usuario:caller.usuario,nombre:caller.nombre,rol:caller.rol,auth_id:user.id,
        detalle:{ventaId,cuf:fac.cuf,operationId,servidor:true},server_created_at:new Date().toISOString(),
      });
      return json({ok:true,operationId});
    }

    if(!["issue","manual"].includes(action)) return json({ok:false,error:"Acción no permitida"},400);

    const {data:replay}=await admin.from("facturas_venta").select("*").eq("operation_id",operationId).maybeSingle();
    if(replay){
      if(replay.estado==="emitida") return json({ok:true,replay:true,cuf:replay.cuf||"",numero:replay.numero||"",
        qrUrl:replay.qr_url||"",pdf:replay.pdf_url||"",nitComprador:Number(replay.nit_comprador)||0,
        nombreComprador:replay.nombre_comprador||"Sin Nombre",telefono:replay.telefono||""});
      return json({ok:false,error:"La emisión anterior quedó en revisión. No se duplicó la factura.",code:"INVOICE_REVIEW_REQUIRED"},409);
    }

    const {data:venta}=await admin.from("ventas").select("*").eq("id",ventaId).maybeSingle();
    if(!venta||venta.anulada) return json({ok:false,error:"Venta inexistente o anulada"},404);
    const {data:items}=await admin.from("venta_items").select("*").eq("venta_id",ventaId).order("id");
    if(!items?.length) return json({ok:false,error:"La venta no tiene líneas facturables"},409);

    const nit=str(body.nit,30)||"0";
    const nombre=str(body.nombre,200)||"Sin Nombre";
    const telefono=str(body.telefono,30);
    const proveedor=action==="manual"?"MANUAL":"CUCU";
    const {data:reservation,error:reserveError}=await admin.from("facturas_venta").insert({
      venta_id:ventaId,proveedor,estado:"procesando",nombre_comprador:nombre,nit_comprador:nit,
      telefono,operation_id:operationId,metadata:{reservedBy:caller.usuario,reservedAt:new Date().toISOString()},
    }).select("id").single();
    if(reserveError){
      if(reserveError.code==="23505") return json({ok:false,error:"La venta ya tiene una factura activa"},409);
      throw reserveError;
    }

    let result:{providerId:string;cuf:string;numero:string;qrUrl:string;pdf:string};
    if(action==="manual"){
      const numero=str(body.numero,100),cuf=str(body.cuf,300);
      if(!numero&&!cuf){
        await admin.from("facturas_venta").delete().eq("id",reservation.id);
        return json({ok:false,error:"Número de factura o CUF requerido"},400);
      }
      result={providerId:"",numero,cuf,qrUrl:"",pdf:""};
    }else{
      if(!apiKey||!pointOfSaleId){
        await admin.from("facturas_venta").delete().eq("id",reservation.id);
        return json({ok:false,error:"Faltan CUCU_API_KEY o CUCU_POINT_OF_SALE_ID en el servidor"},503);
      }
      let metodoPago=1;
      const metodo=String(venta.metodo_pago||"");
      if(metodo==="qr") metodoPago=5;
      else if(metodo==="tarjeta") metodoPago=2;
      else if(metodo.startsWith("mixto|")){
        const montos:{[key:string]:number}={efectivo:0,qr:0,tarjeta:0};
        metodo.split("|").slice(1).forEach((part:string)=>{const [key,value]=part.split(":");if(key in montos)montos[key]=Number(value)||0;});
        const dominante=Object.keys(montos).sort((a,b)=>montos[b]-montos[a])[0];
        metodoPago=dominante==="qr"?5:dominante==="tarjeta"?2:1;
      }
      let response:Response;
      try{
        response=await fetch(endpoint,{
          method:"POST",headers:{"X-API-Key":apiKey,"Content-Type":"application/json"},
          body:JSON.stringify({
            pointOfSaleId,clientDocumentType:5,
            clientDocumentNumber:Number(nit)>0?nit:anonymousDocument,
            clientBusinessName:nombre,paymentMethodCode:metodoPago,
            details:items.map((it:any)=>({
              activityEconomic:actividad,codeProductSin:productoSin,description:str(it.nombre||"Producto",100),
              quantity:Number(it.cantidad)||1,unitMeasure,priceUnit:Number(it.precio_unit)||0,
            })),
          }),signal:AbortSignal.timeout(20000),
        });
      }catch(error){
        await admin.from("facturas_venta").update({estado:"revision",metadata:{error:String(error),operationId}}).eq("id",reservation.id);
        return json({ok:false,error:"Respuesta de CUCU incierta. La operación quedó bloqueada para revisión; no se reemitirá.",code:"INVOICE_REVIEW_REQUIRED"},502);
      }
      if(!response.ok){
        const detail=(await response.text()).slice(0,300);
        await admin.from("facturas_venta").delete().eq("id",reservation.id);
        return json({ok:false,error:`CUCU ${response.status}: ${detail}`},502);
      }
      const bodyCucu=await response.json();
      if(bodyCucu?.success===false){
        await admin.from("facturas_venta").delete().eq("id",reservation.id);
        return json({ok:false,error:str(bodyCucu.message||bodyCucu.error||"CUCU rechazó la factura",300)},502);
      }
      const data=bodyCucu.data||bodyCucu;
      result={
        providerId:String(data.id||""),cuf:data.cuf||"",numero:String(data.invoiceNumber||""),
        qrUrl:data.qrUrl||"",pdf:data.pdfUrl||"",
      };
    }

    const {error:finalError}=await admin.from("facturas_venta").update({
      estado:"emitida",provider_invoice_id:result.providerId||null,numero:result.numero,cuf:result.cuf,qr_url:result.qrUrl,pdf_url:result.pdf,
      metadata:{issuedBy:caller.usuario,operationId,server:true},
    }).eq("id",reservation.id);
    if(finalError) throw finalError;
    await admin.from("audit_log").insert({
      id:`EVT_${crypto.randomUUID().replaceAll("-","")}`,ts:Date.now(),tipo:"FACTURA_EMITIDA",
      usuario:caller.usuario,nombre:caller.nombre,rol:caller.rol,auth_id:user.id,
      detalle:{ventaId,numero:result.numero,cuf:result.cuf,proveedor,operationId,servidor:true},
      server_created_at:new Date().toISOString(),
    });
    return json({ok:true,...result,nitComprador:Number(nit)||0,nombreComprador:nombre,telefono,operationId});
  }catch(error){
    return json({ok:false,error:error instanceof Error?error.message:"Error interno"},500);
  }
});
