import {createClient} from "npm:@supabase/supabase-js@2.119.2";
const cors={
 "Access-Control-Allow-Origin":"https://zeuxidamus1.github.io",
 "Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info",
 "Access-Control-Allow-Methods":"GET,POST,OPTIONS"
};
const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{
 status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}
});
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(!["GET","POST"].includes(request.method))return reply({error:"Method not allowed"},405);
 const secret=Deno.env.get("STRIPE_SECRET_KEY");
 const webhook=Deno.env.get("STRIPE_WEBHOOK_SECRET");
 if(request.method==="GET")return reply({ready:Boolean(secret&&webhook),mode:"one_time",amount_cents:2500,currency:"usd"});
 if(!secret||!webhook)return reply({error:"Checkout is not configured"},503);
 const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
 if(!token)return reply({error:"Sign in required"},401);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!service)return reply({error:"Server is not configured"},503);
 const auth=createClient(url,anon,{auth:{persistSession:false}});
 const {data:{user},error}=await auth.auth.getUser(token);
 if(error||!user||user.is_anonymous)return reply({error:"Sign in required"},401);
 let input:{case_id?:string};
 try{input=await request.json()}catch{return reply({error:"Invalid request"},400)}
 if(!uuid.test(input.case_id||""))return reply({error:"Invalid case"},400);
 const db=createClient(url,service,{auth:{persistSession:false}});
 const {data:caseRow,error:caseError}=await db.from("removal_cases")
   .select("id,user_id,authorization_id,status,payment_status,payment_provider_id,price_cents,currency")
   .eq("id",input.case_id).eq("user_id",user.id).maybeSingle();
 if(caseError||!caseRow)return reply({error:"Case not found"},404);
 if(caseRow.payment_status==="paid")return reply({error:"This case has already been paid"},409);
 if(!["draft","awaiting_payment"].includes(caseRow.status)||caseRow.price_cents!==2500||caseRow.currency!=="usd")
   return reply({error:"This case is not eligible for checkout"},409);
 const {data:signature}=await db.from("customer_authorizations").select("revoked_at").eq("id",caseRow.authorization_id)
   .eq("user_id",user.id).maybeSingle();
 if(!signature||signature.revoked_at)return reply({error:"Valid customer authorization required"},403);
 let attemptKey="initial";
 if(caseRow.payment_provider_id){
   const previousId=String(caseRow.payment_provider_id);
   if(!/^cs_[A-Za-z0-9_]+$/.test(previousId))return reply({error:"Invalid previous checkout session"},500);
   let previous:Response;
   try{
     previous=await fetch("https://api.stripe.com/v1/checkout/sessions/"+encodeURIComponent(previousId),{
       headers:{Authorization:"Bearer "+secret}
     });
   }catch{return reply({error:"Unable to retrieve existing checkout"},502)}
   if(!previous.ok)return reply({error:"Unable to retrieve existing checkout"},502);
   const oldSession=await previous.json();
   if(oldSession.status==="open" && typeof oldSession.url==="string" &&
      oldSession.url.startsWith("https://checkout.stripe.com/"))
     return reply({checkout_url:oldSession.url});
   if(oldSession.status==="complete")
     return reply({error:"Payment is being confirmed. Refresh your case shortly."},409);
   if(oldSession.status!=="expired")
     return reply({error:"Existing checkout requires review"},409);
   attemptKey=previousId;
 }
 const base="https://zeuxidamus1.github.io/offline-delete/";
 const body=new URLSearchParams({
  mode:"payment",
  "line_items[0][price_data][currency]":"usd",
  "line_items[0][price_data][unit_amount]":"2500",
  "line_items[0][price_data][product_data][name]":"Offline Delete Managed Removal Campaign",
  "line_items[0][price_data][product_data][description]":"One-time managed privacy requests for 22 people-search sources",
  "line_items[0][quantity]":"1",
  "client_reference_id":caseRow.id,
  "metadata[case_id]":caseRow.id,
  "metadata[user_id]":user.id,
  "success_url":base+"managed.html?checkout=success&session_id={CHECKOUT_SESSION_ID}",
  "cancel_url":base+"managed.html?checkout=cancelled"
 });
 if(user.email)body.set("customer_email",user.email);
 let response:Response;
 try{
  response=await fetch("https://api.stripe.com/v1/checkout/sessions",{
   method:"POST",headers:{
    Authorization:"Bearer "+secret,
    "Content-Type":"application/x-www-form-urlencoded",
    "Idempotency-Key":"offline-managed-"+caseRow.id+"-"+attemptKey
   },body
  });
 }catch{return reply({error:"Payment provider unavailable"},502)}
 if(!response.ok)return reply({error:"Could not start secure checkout"},502);
 const session=await response.json();
 if(typeof session.id!=="string"||!session.id.startsWith("cs_")||
    typeof session.url!=="string"||!session.url.startsWith("https://checkout.stripe.com/"))
   return reply({error:"Unexpected checkout response"},502);
 const {data:updated,error:updateError}=await db.from("removal_cases")
  .update({status:"awaiting_payment",payment_status:"pending",payment_provider_id:session.id,updated_at:new Date().toISOString()})
  .eq("id",caseRow.id).eq("user_id",user.id).in("payment_status",["pending","not_configured"])
  .select("id").maybeSingle();
 if(updateError||!updated)return reply({error:"Unable to save checkout status"},500);
 return reply({checkout_url:session.url});
});