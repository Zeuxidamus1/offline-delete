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
 let body:{action?:string;task_id?:string;status?:string;note?:string;delivery_reference?:string};
 try{body=await req.json()}catch{return response({error:"Invalid request"},400)}
 if(body.action==="list"){
   const {data:cases,error:caseError}=await db.from("removal_cases")
      .select("id,user_id,authorization_id,status,price_cents,payment_status,created_at,updated_at").order("created_at",{ascending:false}).limit(100);
   if(caseError)return response({error:"Unable to load cases"},500);
   const {data:sites}=await db.from("supported_sites").select("slug,name,search_url,optout_url,terms_reviewed,search_mode");
   const authIds=(cases||[]).map(x=>x.authorization_id).filter(Boolean);
   const {data:authorizations}=authIds.length?await db.from("customer_authorizations")
      .select("id,revoked_at").in("id",authIds):{data:[]};
   const ids=(cases||[]).map(x=>x.id);
   if(!ids.length)return response({cases:[],tasks:[],customers:[],sites:sites||[],authorizations:[],correspondence:[],channels:[]});
   const users=[...new Set((cases||[]).map(x=>x.user_id))];
   const [taskResult,profileResult,lettersResult,channelResult]=await Promise.all([
     db.from("case_site_tasks").select("id,case_id,user_id,site_slug,status,channel,internal_note,updated_at")
       .in("case_id",ids).order("updated_at",{ascending:false}).limit(2200),
     db.from("customer_profiles").select("user_id,first_name,last_name").in("user_id",users),
     db.from("case_removal_correspondence").select("id,case_id,task_id,site_slug,channel,delivery_status,subject,body,delivery_reference,submitted_at").in("case_id",ids).limit(2200),
     db.from("removal_channel_registry").select("site_slug,accepted_channel,submission_url,reviewed_at,review_notes,automated_delivery_approved")
   ]);
   if(taskResult.error||profileResult.error||lettersResult.error||channelResult.error)return response({error:"Unable to load case details"},500);
   return response({cases,tasks:taskResult.data||[],customers:profileResult.data||[],sites:sites||[],authorizations:authorizations||[],correspondence:lettersResult.data||[],channels:channelResult.data||[]});
 }
 if(body.action==="record_manual_submission"){
   const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
   const receipt=String(body.delivery_reference||"").trim();
   if(!uuid.test(body.task_id||"") || receipt.length<8 || receipt.length>500)
      return response({error:"Provide the task and an actual confirmation or receipt reference (8-500 characters)."},400);
   const {data:task}=await db.from("case_site_tasks").select("id,case_id,user_id,site_slug,status")
      .eq("id",body.task_id).maybeSingle();
   if(!task)return response({error:"Task not found"},404);
   const {data:caseRow}=await db.from("removal_cases").select("authorization_id,payment_status,status")
      .eq("id",task.case_id).eq("user_id",task.user_id).maybeSingle();
   if(!caseRow||caseRow.payment_status!=="paid"||!["paid","active"].includes(caseRow.status))
      return response({error:"A confirmed paid campaign is required."},403);
   const {data:authorization}=await db.from("customer_authorizations").select("revoked_at")
      .eq("id",caseRow.authorization_id).eq("user_id",task.user_id).maybeSingle();
   if(!authorization||authorization.revoked_at)return response({error:"Customer authorization is missing or revoked"},403);
   const {data:letter}=await db.from("case_removal_correspondence")
      .select("id,delivery_status").eq("task_id",task.id).maybeSingle();
   if(!letter)return response({error:"Prepare the case first"},409);
   if(letter.delivery_status==="submitted")return response({error:"Already submitted. Do not duplicate the request."},409);
   const now=new Date().toISOString();
   const {data:changed,error:updateError}=await db.from("case_removal_correspondence")
      .update({delivery_status:"submitted",delivery_reference:receipt,submitted_at:now,verified_by:user.id,updated_at:now})
      .eq("id",letter.id).neq("delivery_status","submitted").select("id,delivery_status").maybeSingle();
   if(updateError||!changed)return response({error:"Unable to record submission"},409);
   await db.from("case_site_tasks").update({status:"sent",last_action_at:now,updated_at:now})
     .eq("id",task.id);
   await db.from("case_events").insert({case_id:task.case_id,user_id:task.user_id,site_slug:task.site_slug,
     actor_id:user.id,event_type:"manual_submission_recorded",detail:"Administrator recorded a manual submission reference."});
   return response({correspondence:changed});
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
  const {data:caseRow}=await db.from("removal_cases").select("authorization_id,payment_status,status").eq("id",task.case_id).maybeSingle();
  const {data:signature}=caseRow?await db.from("customer_authorizations").select("revoked_at").eq("id",caseRow.authorization_id).maybeSingle():{data:null};
  if(!signature || signature.revoked_at)return response({error:"Customer authorization is missing or revoked"},403);
  if(caseRow?.payment_status!=="paid")return response({error:"Only paid cases can be processed"},403);
  const {data:existingLetter}=await db.from("case_removal_correspondence")
    .select("delivery_status").eq("task_id",task.id).maybeSingle();
  if(existingLetter?.delivery_status==="submitted"||task.status==="sent"||task.status==="verified_removed")
    return response({error:"Submitted or completed work cannot be overwritten by a status edit"},409);
  if(body.status==="ready_to_send"){
    const {data:channel}=await db.from("removal_channel_registry").select("accepted_channel,reviewed_at").eq("site_slug",task.site_slug).maybeSingle();
    if(!channel?.reviewed_at || channel.accepted_channel==="unverified")return response({error:"The provider submission channel is unverified"},409);
  }
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