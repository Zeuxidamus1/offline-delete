import { createClient } from "npm:@supabase/supabase-js@2.119.2";
const cors={"Access-Control-Allow-Origin":"https://zeuxidamus1.github.io","Access-Control-Allow-Headers":"authorization,apikey,content-type,x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
async function reserve(db:any){
 const month=new Date().toISOString().slice(0,7);
 const {error:e}=await db.from("scan_credit_budget").upsert({month_key:month,reserved_credits:0},{onConflict:"month_key",ignoreDuplicates:true});
 if(e)return false;
 for(let i=0;i<5;i++){
  const {data,error}=await db.from("scan_credit_budget").select("reserved_credits").eq("month_key",month).single();
  if(error||!data||data.reserved_credits>=750)return false;
  const {data:updated,error:write}=await db.from("scan_credit_budget")
   .update({reserved_credits:data.reserved_credits+1,updated_at:new Date().toISOString()})
   .eq("month_key",month).eq("reserved_credits",data.reserved_credits).select("reserved_credits").maybeSingle();
  if(write)return false;
  if(updated)return true;
 }
 return false;
}
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(request.method!=="POST")return json({error:"Method not allowed"},405);
 const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
 if(!token)return json({error:"Sign in required"},401);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),
 service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),tavily=Deno.env.get("TAVILY_API_KEY");
 if(!url||!anon||!service||!tavily)return json({error:"Verification provider unavailable"},503);
 const auth=createClient(url,anon,{auth:{persistSession:false}});
 const {data:{user},error:authError}=await auth.auth.getUser(token);
 if(authError||!user||user.is_anonymous)return json({error:"Sign in required"},401);
 const db=createClient(url,service,{auth:{persistSession:false}});
 let payload:{removal_id?:string};
 try{payload=await request.json()}catch{return json({error:"Invalid request"},400)}
 if(!/^[0-9a-f-]{36}$/i.test(String(payload.removal_id||"")))return json({error:"Invalid removal"},400);
 const {data:removal}=await db.from("privacy_removals").select("id,finding_id,status")
   .eq("id",payload.removal_id).eq("user_id",user.id).maybeSingle();
 if(!removal||!['submitted','pending'].includes(removal.status))return json({error:"Only submitted requests can be rechecked"},400);
 const {data:finding}=await db.from("privacy_findings").select("listing_url,source_name")
   .eq("id",removal.finding_id).eq("user_id",user.id).maybeSingle();
 const {data:profile}=await db.from("customer_profiles").select("first_name,last_name,consent_to_search")
   .eq("user_id",user.id).maybeSingle();
 if(!finding||!profile?.consent_to_search)return json({error:"Authorized listing unavailable"},403);
 let source:URL;
 try{source=new URL(finding.listing_url)}catch{return json({error:"Invalid saved listing URL"},400)}
 if(source.protocol!=="https:")return json({error:"Invalid saved listing URL"},400);
 const {data:site}=await db.from("supported_sites").select("domain").eq("name",finding.source_name).maybeSingle();
 if(!site||![site.domain,"www."+site.domain].includes(source.hostname.toLowerCase()))return json({error:"Source not supported"},400);
 const yesterday=new Date(Date.now()-86400000).toISOString();
 const {data:recent}=await db.from("verification_checks").select("id").eq("removal_id",removal.id)
  .eq("method","indexed_search").gte("checked_at",yesterday).limit(1);
 if(recent?.length)return json({error:"Recheck available once per 24 hours"},429);
 if(!await reserve(db))return json({error:"Monthly free search allowance reached"},429);
 let outcome="unable_to_verify";
 try{
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),14000);
  let response:Response;
  try {
   response=await fetch("https://api.tavily.com/search",{
    method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+tavily},
    body:JSON.stringify({query:'"'+profile.first_name+' '+profile.last_name+'" site:'+site.domain+' '+source.pathname.split('/').pop(),
       search_depth:"basic",max_results:10,include_domains:[site.domain],include_answer:false}),
    signal:controller.signal
   });
  }finally{clearTimeout(timer)}
  if(response.ok){
   const body=await response.json();
   if(Array.isArray(body.results)){
    const norm=(u:URL)=>u.origin+u.pathname.replace(/\/$/,"");
    const expected=norm(source);
    const found=body.results.some((item:{url?:string})=>{
     try{
      const candidate=new URL(item.url||"");
      return candidate.protocol==="https:" && norm(candidate)===expected;
     }catch{return false}
    });
    outcome=found?"index_reference_found":"index_reference_missing";
   }
  }
 }catch{}
 const {error:write}=await db.from("verification_checks").insert({
    user_id:user.id,removal_id:removal.id,method:"indexed_search",outcome
 });
 if(write)return json({error:"Unable to save verification check"},500);
 return json({outcome});
});