import {createClient} from "npm:@supabase/supabase-js@2.119.2";
const response=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}});
async function verifyJobToken(db:any,token:string|null){
 if(!token||token.length<64||token.length>256)return false;
 const {data,error}=await db.from("monitoring_job_credentials").select("token").eq("id",1).single();
 if(error||!data?.token)return false;
 const digest=async(v:string)=>new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(v)));
 const [actual,expected]=await Promise.all([digest(token),digest(data.token)]);
 let mismatch=actual.length^expected.length;
 for(let i=0;i<Math.min(actual.length,expected.length);i++)mismatch|=actual[i]^expected[i];
 return mismatch===0;
}
Deno.serve(async request=>{
 if(request.method!=="POST")return response({error:"Method not allowed"},405);
 const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!service)return response({error:"Service unavailable"},503);
 const db=createClient(url,service,{auth:{persistSession:false}});
 if(!await verifyJobToken(db,request.headers.get("x-job-token")))return response({error:"Unauthorized"},401);
 const enabled=Deno.env.get("REMOVAL_DISPATCH_ENABLED")==="true";
 const key=Deno.env.get("RESEND_API_KEY");
 const from=Deno.env.get("REMOVAL_SENDER_EMAIL");
 if(!enabled||!key||!from || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(from))
   return response({enabled:false,attempted:0,sent:0,reason:"Sender not configured or outbound dispatch disabled"});
 const {data:jobs,error:claimError}=await db.rpc("claim_approved_removal_emails",{batch_size:3});
 if(claimError)return response({error:"Unable to claim approved work"},500);
 let sent=0,failed=0;
 for(const job of jobs||[]){
  // Once claimed, do not retry automatically after ambiguous network failures.
  const safeBody=String(job.request_body)
    .replace("This request is prepared for review and has not been sent automatically.\n\n","");
  let messageId:string|null=null;
  let errorCode="provider_error";
  try {
   const controller=new AbortController();
   const timeout=setTimeout(()=>controller.abort(),15000);
   let r:Response;
   try{
    r=await fetch("https://api.resend.com/emails",{
     method:"POST",
     headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json",
       "Idempotency-Key":"offline-case-"+job.correspondence_id},
     body:JSON.stringify({from,to:[job.recipient_email],subject:job.request_subject,text:safeBody}),
     signal:controller.signal
    });
   }finally{clearTimeout(timeout)}
   const result=await r.json().catch(()=>({}));
   if(r.ok && typeof result.id==="string" && result.id.length>5)messageId=result.id;
   else errorCode="provider_"+r.status;
  } catch {
   errorCode="network_or_timeout";
  }
  const now=new Date().toISOString();
  if(messageId){
   const {error:updateError}=await db.from("case_email_dispatches")
     .update({status:"sent",provider_message_id:messageId,completed_at:now})
     .eq("id",job.dispatch_id).eq("status","claimed");
   if(updateError){failed++;continue}
   await db.from("case_removal_correspondence")
     .update({channel:"email",delivery_status:"submitted",delivery_reference:messageId,
       submitted_at:now,updated_at:now})
     .eq("id",job.correspondence_id).eq("delivery_status","awaiting_verified_channel");
   await db.from("case_site_tasks").update({status:"sent",channel:"email",last_action_at:now,updated_at:now})
     .eq("case_id",job.case_id).eq("site_slug",job.site_slug);
   await db.from("case_events").insert({case_id:job.case_id,user_id:job.user_id,site_slug:job.site_slug,
      event_type:"automated_request_sent",detail:"An approved privacy request email was accepted by the mail provider."});
   sent++;
  }else{
   await db.from("case_email_dispatches").update({status:"failed",completed_at:now,error_code:errorCode})
     .eq("id",job.dispatch_id).eq("status","claimed");
   await db.from("case_removal_correspondence")
     .update({delivery_status:"failed",updated_at:now})
     .eq("id",job.correspondence_id).eq("delivery_status","awaiting_verified_channel");
   await db.from("case_events").insert({case_id:job.case_id,user_id:job.user_id,site_slug:job.site_slug,
     event_type:"email_delivery_failed",detail:"Mail delivery requires manual review; no automatic retries."});
   failed++;
  }
 }
 return response({enabled:true,attempted:(jobs||[]).length,sent,failed});
});