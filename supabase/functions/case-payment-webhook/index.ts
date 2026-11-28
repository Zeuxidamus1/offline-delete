import {createClient} from "npm:@supabase/supabase-js@2.119.2";
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{"Content-Type":"application/json","Cache-Control":"no-store"}
});
function constantTimeEqual(actual:string,expected:string){
 if(actual.length!==expected.length)return false;
 let mismatch=0;
 for(let i=0;i<actual.length;i++)mismatch|=actual.charCodeAt(i)^expected.charCodeAt(i);
 return mismatch===0;
}
async function verify(raw:string,header:string,secret:string){
 const components=header.split(",").map(x=>x.trim().split("="));
 const time=components.find(x=>x[0]==="t")?.[1];
 const validSignatures=components.filter(x=>x[0]==="v1").map(x=>x[1]);
 const unix=Number(time);
 if(!Number.isSafeInteger(unix)||Math.abs(Date.now()/1000-unix)>300||!validSignatures.length)return false;
 const encoder=new TextEncoder();
 const key=await crypto.subtle.importKey("raw",encoder.encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const signature=new Uint8Array(await crypto.subtle.sign("HMAC",key,encoder.encode(time+"."+raw)));
 const expected=[...signature].map(x=>x.toString(16).padStart(2,"0")).join("");
 return validSignatures.some(provided=>constantTimeEqual(provided,expected));
}
Deno.serve(async request=>{
 if(request.method!=="POST")return reply({error:"Method not allowed"},405);
 const signingSecret=Deno.env.get("STRIPE_WEBHOOK_SECRET");
 const url=Deno.env.get("SUPABASE_URL"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!signingSecret||!url||!service)return reply({error:"Payment listener not configured"},503);
 const header=request.headers.get("stripe-signature")||"";
 const raw=await request.text();
 if(raw.length>200000)return reply({error:"Payload too large"},413);
 if(!await verify(raw,header,signingSecret))return reply({error:"Invalid Stripe signature"},400);
 let event:any;
 try{event=JSON.parse(raw)}catch{return reply({error:"Invalid webhook event"},400)}
 if(typeof event?.id!=="string"||!event.id.startsWith("evt_"))return reply({error:"Invalid event"},400);
 if(!["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(event.type))
   return reply({received:true,ignored:true});
 const session=event.data?.object;
 if(!session||session.object!=="checkout.session"||session.mode!=="payment"||
    session.payment_status!=="paid"||session.amount_total!==2500||
    String(session.currency).toLowerCase()!=="usd")
   return reply({received:true,ignored:true});
 const caseId=session.metadata?.case_id,uid=session.metadata?.user_id;
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
 if(!uuid.test(String(caseId))||!uuid.test(String(uid))||session.client_reference_id!==caseId)
   return reply({error:"Case reference mismatch"},400);
 const db=createClient(url,service,{auth:{persistSession:false}});
 const {data:caseRow,error:lookupError}=await db.from("removal_cases")
   .select("id,user_id,status,payment_status,payment_provider_id,price_cents,currency")
   .eq("id",caseId).eq("user_id",uid).maybeSingle();
 if(lookupError)return reply({error:"Unable to verify transaction case"},500);
 if(!caseRow||caseRow.payment_provider_id!==session.id||
    caseRow.price_cents!==2500||caseRow.currency!=="usd")
   return reply({error:"Unrecognized transaction"},400);
 if(caseRow.payment_status!=="paid"){
  if(caseRow.payment_status!=="pending"||caseRow.status!=="awaiting_payment")
    return reply({error:"Case awaiting payment reconciliation"},503);
  const {data:paid,error:paidError}=await db.from("removal_cases")
    .update({status:"paid",payment_status:"paid",updated_at:new Date().toISOString()})
    .eq("id",caseId).eq("user_id",uid).eq("payment_provider_id",session.id)
    .eq("payment_status","pending").select("id").maybeSingle();
  if(paidError)return reply({error:"Could not record payment"},500);
  if(paid){
    await db.from("case_events").insert({case_id:caseId,user_id:uid,event_type:"payment_confirmed",
      detail:"Payment confirmed through a signed Stripe webhook. Case awaiting review."});
  }
 }
 const {error:receiptError}=await db.from("case_payment_events")
   .upsert({stripe_event_id:event.id,case_id:caseId,event_type:event.type},{onConflict:"stripe_event_id",ignoreDuplicates:true});
 if(receiptError)return reply({error:"Could not store payment receipt"},500);
 return reply({received:true});
});