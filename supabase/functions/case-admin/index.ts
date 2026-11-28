import {createClient} from "npm:@supabase/supabase-js@2.119.2";
const cors={"Access-Control-Allow-Origin":"https://zeuxidamus1.github.io","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return response({error:"Method not allowed"},405);
 const token=req.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!token||!url||!anon||!service)return response({error:"Authorization required"},401);
 const auth=createClient(url,anon,{auth:{persistSession:false}});
 const {data:{user},error:err}=await auth.auth.getUser(token);
 if(err||!user||user.is_anonymous)return response({error:"Authorization required"},401);
 const db=createClient(url,service,{auth:{persistSession:false}});
 const {data:admin,error:adminErr}=await db.from("case_administrators").select("user_id").eq("user_id",user.id).maybeSingle();
 if(adminErr||!admin)return response({error:"Administrator access required"},403);
 let body:{action?:string;task_id?:string;status?:string;note?:string};
 try{body=await req.json()}catch{return response({error:"Invalid request"},400)}
 if(body.action==="list"){
   const {data:cases,error:caseError}=await db.from("removal_cases")
      .select("id,user_id,status,price_cents,payment_status,created_at,updated_at").order("created_at",{ascending:false}).limit(100);
   if(caseError)return response({error:"Unable to load cases"},500);
   const ids=(cases||[]).map(x=>x.id);
   if(!ids.length)return response({cases:[],tasks:[],customers:[]});
   const users=[...new Set((cases||[]).map(x=>x.user_id))];
   const [taskResult,profileResult]=await Promise.all([
     db.from("case_site_tasks").select("id,case_id,user_id,site_slug,status,channel,internal_note,updated_at")
       .in("case_id",ids).order("updated_at",{ascending:false}).limit(2200),
     db.from("customer_profiles").select("user_id,first_name,last_name").in("user_id",users)
   ]);
   if(taskResult.error||profileResult.error)return response({error:"Unable to load case details"},500);
   return response({cases,tasks:taskResult.data||[],customers:profileResult.data||[]});
 }
 if(body.action==="update_task"){
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  const allowed=["research_needed","manual_action","ready_to_send","customer_action","unable_to_verify","not_found"];
  if(!uuid.test(body.task_id||"")||!allowed.includes(body.status||""))return response({error:"Invalid task update"},400);
  const note=String(body.note||"").trim();
  if(note.length>1500)return response({error:"Note too long"},400);
  const {data:task,error:loadError}=await db.from("case_site_tasks").select("id,case_id,user_id,site_slug,status")
    .eq("id",body.task_id).maybeSingle();
  if(loadError||!task)return response({error:"Task not found"},404);
  const {data:updated,error:updateError}=await db.from("case_site_tasks")
    .update({status:body.status,internal_note:note||null,updated_at:new Date().toISOString(),last_action_at:new Date().toISOString()})
    .eq("id",task.id).select("id,status").single();
  if(updateError||!updated)return response({error:"Unable to update task"},500);
  await db.from("case_events").insert({case_id:task.case_id,user_id:task.user_id,site_slug:task.site_slug,
    actor_id:user.id,event_type:"admin_task_updated",detail:"Admin set task to "+body.status});
  return response({task:updated});
 }
 return response({error:"Unsupported action"},400);
});