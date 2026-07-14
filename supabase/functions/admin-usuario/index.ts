import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders={
  "Access-Control-Allow-Origin":"*",
  "Access-Control-Allow-Headers":"authorization, x-client-info, apikey, content-type",
};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
  status,headers:{...corsHeaders,"Content-Type":"application/json"},
});
const uuidOk=(value:string)=>/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const auditId=(operationId:string,suffix:string)=>`EVT_${operationId.replaceAll("-","")}_${suffix}`;
async function sha256(value:string){
  const bytes=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");
}

Deno.serve(async(req)=>{
  if(req.method==="OPTIONS") return new Response("ok",{headers:corsHeaders});
  if(req.method!=="POST") return json({ok:false,error:"Método no permitido"},405);

  const url=Deno.env.get("SUPABASE_URL")!;
  const anonKey=Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  let admin:any=null,operationId="",action="",usuario="",caller:any=null,userId="";
  let mutationApplied=false;

  try{
    const authorization=req.headers.get("Authorization")||"";
    const userClient=createClient(url,anonKey,{global:{headers:{Authorization:authorization}}});
    const {data:{user},error:userError}=await userClient.auth.getUser();
    if(userError||!user) return json({ok:false,error:"Sesión inválida"},401);
    userId=user.id;

    admin=createClient(url,serviceKey,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:profile}=await admin.from("usuarios").select("usuario,nombre,rol,estado").eq("auth_id",user.id).maybeSingle();
    caller=profile;
    if(!caller||caller.estado!=="activo"||caller.rol!=="admin")
      return json({ok:false,error:"Permiso administrativo requerido"},403);

    const body=await req.json();
    action=String(body.action||"");
    usuario=String(body.usuario||"").trim().toLowerCase();
    operationId=String(body.operationId||"");
    if(!uuidOk(operationId)) return json({ok:false,error:"operationId inválido"},400);
    if(!usuario) return json({ok:false,error:"Usuario requerido"},400);
    if(!["reset_password","delete","set_state","update_profile"].includes(action))
      return json({ok:false,error:"Acción no permitida"},400);

    const canonical=JSON.stringify({
      action,usuario,password:action==="reset_password"?String(body.password||""):undefined,
      estado:body.estado??null,nombre:body.nombre??null,rol:body.rol??null,marca_id:body.marca_id??null,
    });
    const payloadHash=await sha256(canonical);
    const {error:reserveError}=await admin.from("th_admin_operaciones").insert({
      id:operationId,accion:action,afectado:usuario,payload_hash:payloadHash,estado:"procesando",
      solicitado_por:caller.usuario,auth_id:user.id,
    });
    if(reserveError){
      if(reserveError.code!=="23505") throw reserveError;
      const {data:old}=await admin.from("th_admin_operaciones").select("*").eq("id",operationId).maybeSingle();
      if(!old||old.accion!==action||old.afectado!==usuario||old.payload_hash!==payloadHash)
        return json({ok:false,error:"La clave idempotente pertenece a otra solicitud"},409);
      if(old.estado==="confirmada") return json({...(old.resultado||{ok:true}),replay:true});
      if(old.estado==="rechazada") return json({ok:false,error:old.error_message||"Solicitud rechazada",replay:true},409);
      return json({ok:false,error:"La operación administrativa está procesando o requiere revisión",code:"ADMIN_REVIEW_REQUIRED"},409);
    }

    const requestAudit={
      id:auditId(operationId,"REQ"),ts:Date.now(),tipo:"USUARIO_ADMIN_SOLICITADO",
      usuario:caller.usuario,nombre:caller.nombre||caller.usuario,rol:caller.rol,auth_id:user.id,
      operation_id:operationId,detalle:{action,afectado:usuario,servidor:true},server_created_at:new Date().toISOString(),
    };
    const {error:requestAuditError}=await admin.from("audit_log").insert(requestAudit);
    if(requestAuditError){
      await admin.from("th_admin_operaciones").delete().eq("id",operationId);
      throw new Error(`No se pudo reservar la auditoría: ${requestAuditError.message}`);
    }

    const {data:target}=await admin.from("usuarios").select("usuario,auth_id,rol,estado").eq("usuario",usuario).maybeSingle();
    if(!target) throw new Error("Usuario no encontrado");
    if(target.auth_id===user.id&&action==="delete") throw new Error("No puedes eliminar tu propia sesión administrativa");

    const removesAdmin=target.rol==="admin"&&(
      action==="delete"||(action==="set_state"&&body.estado==="inactivo")||
      (action==="update_profile"&&(body.rol!=="admin"||body.estado==="inactivo"))
    );
    if(removesAdmin){
      const {count}=await admin.from("usuarios").select("usuario",{count:"exact",head:true}).eq("rol","admin").eq("estado","activo");
      if((count||0)<=1) throw new Error("No se puede retirar el último administrador activo");
    }

    if(action==="reset_password"){
      const password=String(body.password||"");
      if(password.length<8) throw new Error("La contraseña debe tener al menos 8 caracteres");
      if(!target.auth_id) throw new Error("El usuario todavía no tiene auth_id");
      const {error}=await admin.auth.admin.updateUserById(target.auth_id,{password});
      if(error) throw error;
      mutationApplied=true;
    }else if(action==="delete"){
      if(target.auth_id){
        const {error}=await admin.auth.admin.deleteUser(target.auth_id);
        if(error) throw error;
        mutationApplied=true;
      }
      const {error}=await admin.from("usuarios").delete().eq("usuario",usuario);
      if(error) throw error;
      mutationApplied=true;
    }else if(action==="set_state"){
      const estado=String(body.estado||"");
      if(!["activo","inactivo"].includes(estado)) throw new Error("Estado inválido");
      const {error}=await admin.from("usuarios").update({estado,updated_at:new Date().toISOString()}).eq("usuario",usuario);
      if(error) throw error;
      mutationApplied=true;
    }else{
      const nombre=String(body.nombre||"").trim();
      const rol=String(body.rol||"");
      const marcaId=body.marca_id==null?null:Number(body.marca_id);
      if(!nombre||!["admin","caja","marca"].includes(rol)) throw new Error("Perfil inválido");
      if(rol==="marca"&&!Number.isFinite(marcaId)) throw new Error("La cuenta de marca requiere marca_id");
      const {error}=await admin.from("usuarios").update({
        nombre,rol,marca_id:rol==="marca"?marcaId:null,
        estado:["activo","inactivo"].includes(body.estado)?body.estado:"activo",
        updated_at:new Date().toISOString(),
      }).eq("usuario",usuario);
      if(error) throw error;
      mutationApplied=true;
    }

    const result={ok:true,action,usuario,operationId};
    const {error:confirmAuditError}=await admin.from("audit_log").insert({
      id:auditId(operationId,"OK"),ts:Date.now(),tipo:"USUARIO_ADMIN_CONFIRMADO",
      usuario:caller.usuario,nombre:caller.nombre||caller.usuario,rol:caller.rol,auth_id:user.id,
      operation_id:operationId,detalle:{action,afectado:usuario,servidor:true},server_created_at:new Date().toISOString(),
    });
    if(confirmAuditError) throw new Error(`La acción ocurrió pero no se confirmó su auditoría: ${confirmAuditError.message}`);
    const {error:completeError}=await admin.from("th_admin_operaciones").update({
      estado:"confirmada",resultado:result,completed_at:new Date().toISOString(),updated_at:new Date().toISOString(),
    }).eq("id",operationId);
    if(completeError) throw new Error(`La acción ocurrió pero no se cerró su operación: ${completeError.message}`);
    return json(result);
  }catch(error){
    const message=error instanceof Error?error.message:"Error interno";
    if(admin&&uuidOk(operationId)){
      const estado=mutationApplied?"revision":"rechazada";
      await admin.from("th_admin_operaciones").update({
        estado,error_message:message,completed_at:mutationApplied?null:new Date().toISOString(),updated_at:new Date().toISOString(),
      }).eq("id",operationId);
      if(caller) await admin.from("audit_log").insert({
        id:auditId(operationId,mutationApplied?"REV":"ERR"),ts:Date.now(),
        tipo:mutationApplied?"USUARIO_ADMIN_REVISION":"USUARIO_ADMIN_RECHAZADO",
        usuario:caller.usuario,nombre:caller.nombre||caller.usuario,rol:caller.rol,auth_id:userId||null,
        operation_id:operationId,detalle:{action,afectado:usuario,error:message,servidor:true},server_created_at:new Date().toISOString(),
      });
    }
    return json({ok:false,error:message,code:mutationApplied?"ADMIN_REVIEW_REQUIRED":"ADMIN_REJECTED"},mutationApplied?500:400);
  }
});
