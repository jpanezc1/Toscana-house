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
  let admin:any=null,caller:any=null,userId="",operationId="",usuario="";
  let mutationApplied=false,createdAuthId="";

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
      return json({ok:false,error:"Solo un administrador puede crear usuarios"},403);

    const body=await req.json();
    usuario=String(body.usuario||"").trim().toLowerCase();
    const password=String(body.password||"");
    const nombre=String(body.nombre||"").trim();
    const rol=String(body.rol||"caja");
    const marcaId=body.marca_id==null?null:Number(body.marca_id);
    operationId=String(body.operationId||"");
    if(!uuidOk(operationId)) return json({ok:false,error:"operationId inválido"},400);
    if(!/^[a-z0-9._-]{3,40}$/.test(usuario)) return json({ok:false,error:"Usuario inválido"},400);
    if(password.length<8) return json({ok:false,error:"La contraseña debe tener al menos 8 caracteres"},400);
    if(!nombre||!["admin","caja","marca"].includes(rol)) return json({ok:false,error:"Perfil inválido"},400);
    if(rol==="marca"&&!Number.isFinite(marcaId)) return json({ok:false,error:"La cuenta de marca requiere marca_id"},400);

    const payloadHash=await sha256(JSON.stringify({usuario,password,nombre,rol,marca_id:marcaId}));
    const {error:reserveError}=await admin.from("th_admin_operaciones").insert({
      id:operationId,accion:"create",afectado:usuario,payload_hash:payloadHash,estado:"procesando",
      solicitado_por:caller.usuario,auth_id:user.id,
    });
    if(reserveError){
      if(reserveError.code!=="23505") throw reserveError;
      const {data:old}=await admin.from("th_admin_operaciones").select("*").eq("id",operationId).maybeSingle();
      if(!old||old.accion!=="create"||old.afectado!==usuario||old.payload_hash!==payloadHash)
        return json({ok:false,error:"La clave idempotente pertenece a otra solicitud"},409);
      if(old.estado==="confirmada") return json({...(old.resultado||{ok:true}),replay:true});
      if(old.estado==="rechazada") return json({ok:false,error:old.error_message||"Solicitud rechazada",replay:true},409);
      return json({ok:false,error:"El alta está procesando o requiere revisión",code:"ADMIN_REVIEW_REQUIRED"},409);
    }

    const {error:requestAuditError}=await admin.from("audit_log").insert({
      id:auditId(operationId,"REQ"),ts:Date.now(),tipo:"USUARIO_CREAR_SOLICITADO",
      usuario:caller.usuario,nombre:caller.nombre||caller.usuario,rol:caller.rol,auth_id:user.id,
      operation_id:operationId,detalle:{afectado:usuario,rol,marcaId,servidor:true},server_created_at:new Date().toISOString(),
    });
    if(requestAuditError){
      await admin.from("th_admin_operaciones").delete().eq("id",operationId);
      throw new Error(`No se pudo reservar la auditoría: ${requestAuditError.message}`);
    }

    const {data:created,error:createError}=await admin.auth.admin.createUser({
      email:`${usuario}@th.internal`,password,email_confirm:true,user_metadata:{usuario,nombre},
    });
    if(createError) throw createError;
    createdAuthId=created.user.id;
    mutationApplied=true;

    const {error:profileError}=await admin.from("usuarios").upsert({
      usuario,nombre,rol,marca_id:rol==="marca"?marcaId:null,estado:"activo",
      auth_id:created.user.id,updated_at:new Date().toISOString(),
    },{onConflict:"usuario"});
    if(profileError){
      const {error:cleanupError}=await admin.auth.admin.deleteUser(created.user.id);
      if(!cleanupError){mutationApplied=false;createdAuthId="";}
      throw new Error(cleanupError
        ? `No se creó el perfil y el usuario Auth requiere revisión: ${profileError.message}`
        : `No se pudo crear el perfil operativo: ${profileError.message}`);
    }

    const result={ok:true,usuario,authId:created.user.id,operationId};
    const {error:confirmAuditError}=await admin.from("audit_log").insert({
      id:auditId(operationId,"OK"),ts:Date.now(),tipo:"USUARIO_CREADO",
      usuario:caller.usuario,nombre:caller.nombre||caller.usuario,rol:caller.rol,auth_id:user.id,
      operation_id:operationId,detalle:{afectado:usuario,rol,marcaId,authId:created.user.id,servidor:true},
      server_created_at:new Date().toISOString(),
    });
    if(confirmAuditError) throw new Error(`El usuario fue creado pero no se confirmó su auditoría: ${confirmAuditError.message}`);
    const {error:completeError}=await admin.from("th_admin_operaciones").update({
      estado:"confirmada",resultado:result,completed_at:new Date().toISOString(),updated_at:new Date().toISOString(),
    }).eq("id",operationId);
    if(completeError) throw new Error(`El usuario fue creado pero no se cerró su operación: ${completeError.message}`);
    return json(result);
  }catch(error){
    const message=error instanceof Error?error.message:"Error interno";
    if(admin&&uuidOk(operationId)){
      const estado=mutationApplied?"revision":"rechazada";
      await admin.from("th_admin_operaciones").update({
        estado,error_message:message,resultado:createdAuthId?{authId:createdAuthId,usuario}:null,
        completed_at:mutationApplied?null:new Date().toISOString(),updated_at:new Date().toISOString(),
      }).eq("id",operationId);
      if(caller) await admin.from("audit_log").insert({
        id:auditId(operationId,mutationApplied?"REV":"ERR"),ts:Date.now(),
        tipo:mutationApplied?"USUARIO_CREAR_REVISION":"USUARIO_CREAR_RECHAZADO",
        usuario:caller.usuario,nombre:caller.nombre||caller.usuario,rol:caller.rol,auth_id:userId||null,
        operation_id:operationId,detalle:{afectado:usuario,error:message,authId:createdAuthId||null,servidor:true},
        server_created_at:new Date().toISOString(),
      });
    }
    return json({ok:false,error:message,code:mutationApplied?"ADMIN_REVIEW_REQUIRED":"ADMIN_REJECTED"},mutationApplied?500:400);
  }
});
