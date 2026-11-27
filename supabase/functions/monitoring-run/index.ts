import { createClient } from "npm:@supabase/supabase-js@2.119.2";
const cors={
 "Access-Control-Allow-Origin":"https://zeuxidamus1.github.io",
 "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info",
 "Access-Control-Allow-Methods":"GET,POST,OPTIONS","Vary":"Origin"
};
function json(body:unknown,status=200) {
 return new Response(JSON.stringify(body),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
}
type Site={slug:string;name:string;domain:string;search_mode:string};
type Profile={first_name:string;last_name:string;city?:string;state?:string;consent_to_search:boolean};
async function reserveBudget(db:any,credits:number) {
 const month=new Date().toISOString().slice(0,7);
 const {error:seedError}=await db.from("scan_credit_budget").upsert(
  {month_key:month,reserved_credits:0},{onConflict:"month_key",ignoreDuplicates:true});
 if(seedError) return false;
 for(let attempt=0;attempt<5;attempt++){
  const {data,error}=await db.from("scan_credit_budget").select("reserved_credits").eq("month_key",month).single();
  if(error||!data||data.reserved_credits+credits>750) return false;
  const {data:reserved,error:saveError}=await db.from("scan_credit_budget")
    .update({reserved_credits:data.reserved_credits+credits,updated_at:new Date().toISOString()})
    .eq("month_key",month).eq("reserved_credits",data.reserved_credits)
    .select("reserved_credits").maybeSingle();
  if(saveError)return false;
  if(reserved)return true;
 }
 return false;
}
async function discover(site:Site,profile:Profile,key:string){
 const query=[
  '"'+profile.first_name+' '+profile.last_name+'"',
  profile.city?'"'+profile.city+'"':"",
  profile.state?'"'+profile.state+'"':"",
  "site:"+site.domain
 ].filter(Boolean).join(" ");
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),14000);
 try {
  const response=await fetch("https://api.tavily.com/search",{
    method:"POST",headers:{"Content-Type":"application/json","Authorization":"Bearer "+key},
    body:JSON.stringify({query,search_depth:"basic",max_results:5,
      include_domains:[site.domain],include_answer:false,include_raw_content:false}),
    signal:controller.signal
  });
  if(!response.ok)throw new Error("Search provider response: "+response.status);
  const body=await response.json();
  if(!Array.isArray(body.results))throw new Error("Invalid provider result");
  const urls=new Set<string>();
  for(const result of body.results){
    if(typeof result.url!=="string")continue;
    let u:URL;
    try{u=new URL(result.url)}catch{continue;}
    const host=u.hostname.toLowerCase();
    if(u.protocol!=="https:"||!(host===site.domain||host==="www."+site.domain))continue;
    const path=u.pathname.toLowerCase();
    if(path==="/"||path.startsWith("/checkout")||path.startsWith("/optout")||
       path.startsWith("/opt-out")||path.startsWith("/removal")||
       path.startsWith("/search")||path.startsWith("/suppression"))continue;
    if(site.slug==="whitepages"){
      const segments=u.pathname.split("/").filter(Boolean);
      if(segments.length!==4||segments[0].toLowerCase()!=="name"||
        !/^[a-z0-9]{6,40}$/i.test(segments[3]))continue;
    }
    const snippet=[result.title,result.content,u.pathname].filter(x=>typeof x==="string").join(" ").toLowerCase();
    if(!snippet.includes(profile.first_name.toLowerCase())||
       !snippet.includes(profile.last_name.toLowerCase()))continue;
    u.hash="";
    urls.add(u.href);
  }
  return {site,urls:[...urls],status:"indexed_checked" as const};
 } catch {
  return {site,urls:[] as string[],status:"unable_to_check" as const};
 } finally{clearTimeout(timeout)}
}
async function verifyJobToken(db:any,provided:string|null) {
 if(!provided || provided.length<64 || provided.length>256)return false;
 const {data,error}=await db.from("monitoring_job_credentials").select("token").eq("id",1).single();
 if(error||!data?.token)return false;
 const digest=async(value:string)=>new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(value)));
 const [actual,expected]=await Promise.all([digest(provided),digest(data.token)]);
 let mismatch=actual.length^expected.length;
 for(let i=0;i<Math.min(actual.length,expected.length);i++)mismatch |= actual[i]^expected[i];
 return mismatch===0;
}
async function runScheduledScan(db:any,settings:any,sites:Site[],key:string) {
 const uid=settings.user_id;
 const now=new Date();
 const next=(days:number)=>new Date(now.getTime()+days*86400000).toISOString();
 const {data:profile}=await db.from("customer_profiles")
  .select("first_name,last_name,city,state,consent_to_search").eq("user_id",uid).maybeSingle();
 if(!profile?.consent_to_search||!profile?.first_name||!profile?.last_name){
   await db.from("monitoring_schedules").update({enabled:false,updated_at:now.toISOString()}).eq("user_id",uid);
   return "authorization_missing";
 }
 const {data:recent}=await db.from("privacy_scans").select("id").eq("user_id",uid)
   .gte("started_at",next(-1)).limit(1);
 if(recent?.length){
   await db.from("monitoring_schedules").update({last_check_at:now.toISOString(),next_check_at:next(30),updated_at:now.toISOString()}).eq("user_id",uid);
   return "recent_scan_exists";
 }
 const indexed=sites.filter(x=>x.search_mode==="indexed_discovery");
 if(!indexed.length)return "no_sources";
 if(!await reserveBudget(db,indexed.length))return "monthly_budget_exhausted";
 const {data:scan,error:scanError}=await db.from("privacy_scans").insert({user_id:uid,status:"running"}).select("id").single();
 if(scanError||!scan)return "scan_create_failed";
 try{
  const {data:previous,error:previousError}=await db.from("privacy_findings")
    .select("source_name,listing_url").eq("user_id",uid);
  if(previousError)throw new Error("prior lookup failed");
  const known=new Set((previous||[]).map((x:{source_name:string;listing_url:string})=>x.source_name+"|"+x.listing_url));
  const results:Awaited<ReturnType<typeof discover>>[]=[];
  for(let i=0;i<indexed.length;i+=3){
    results.push(...await Promise.all(indexed.slice(i,i+3).map(site=>discover(site,profile as Profile,key))));
  }
  const findings:{user_id:string;scan_id:string;source_name:string;listing_url:string;match_status:string}[]=[];
  const checks:{user_id:string;scan_id:string;site_slug:string;status:string;findings_count:number}[]=[];
  for(const result of results){
   let found=0;
   for(const href of result.urls){
    const k=result.site.name+"|"+href;
    if(known.has(k))continue;
    known.add(k);found++;
    findings.push({user_id:uid,scan_id:scan.id,source_name:result.site.name,listing_url:href,match_status:"possible"});
   }
   checks.push({user_id:uid,scan_id:scan.id,site_slug:result.site.slug,status:result.status,findings_count:found});
  }
  for(const site of sites)if(site.search_mode==="manual_only")checks.push({
    user_id:uid,scan_id:scan.id,site_slug:site.slug,status:"manual_required",findings_count:0});
  if(findings.length){
    const {data:added,error:writeError}=await db.from("privacy_findings")
      .upsert(findings,{onConflict:"user_id,source_name,listing_url",ignoreDuplicates:true})
      .select("id,source_name");
    if(writeError)throw new Error("findings save failed");
    if(added?.length){
      await db.from("monitoring_notifications").insert(added.map((f:{id:string;source_name:string})=>({
        user_id:uid,finding_id:f.id,event:"possible_exposure",message:"Possible listing found on "+f.source_name
      })));
    }
  }
  const {error:checksError}=await db.from("scan_source_results").insert(checks);
  if(checksError)throw new Error("coverage save failed");
  await db.from("privacy_scans").update({status:"completed",completed_at:now.toISOString()}).eq("id",scan.id);
  await db.from("monitoring_schedules").update({last_check_at:now.toISOString(),next_check_at:next(30),updated_at:now.toISOString()}).eq("user_id",uid);
  return "completed";
 }catch{
  await db.from("privacy_scans").update({status:"failed",completed_at:new Date().toISOString()}).eq("id",scan.id);
  await db.from("monitoring_schedules").update({next_check_at:next(7),updated_at:new Date().toISOString()}).eq("user_id",uid);
  return "failed";
 }
}
Deno.serve(async request=>{
 if(request.method!=="POST")return json({error:"Method not allowed"},405);
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),tavily=Deno.env.get("TAVILY_API_KEY");
 if(!url||!key||!tavily)return json({error:"Service unavailable"},503);
 const db=createClient(url,key,{auth:{persistSession:false}});
 const authorized=await verifyJobToken(db,request.headers.get("x-job-token"));
 if(!authorized)return json({error:"Unauthorized"},401);
 const {data:sites,error:siteError}=await db.from("supported_sites")
   .select("slug,name,domain,search_mode").order("slug");
 if(siteError||!sites)return json({error:"Source configuration unavailable"},503);
 const {data:schedules,error:scheduleError}=await db.from("monitoring_schedules")
   .select("user_id,enabled,subscription_active,next_check_at")
   .eq("enabled",true).eq("subscription_active",true)
   .lte("next_check_at",new Date().toISOString()).order("next_check_at").limit(2);
 if(scheduleError)return json({error:"Schedules unavailable"},503);
 const states:string[]=[];
 for(const schedule of schedules||[])states.push(await runScheduledScan(db,schedule,sites as Site[],tavily));
 return json({processed:states.length,results:states});
});