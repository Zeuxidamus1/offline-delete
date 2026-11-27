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
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(!["GET","POST"].includes(request.method))return json({error:"Method not allowed"},405);
 const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
 if(!token)return json({error:"Sign in required"},401);
 const url=Deno.env.get("SUPABASE_URL"),anon=Deno.env.get("SUPABASE_ANON_KEY"),admin=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!anon||!admin)return json({error:"Service unavailable"},503);
 const auth=createClient(url,anon,{auth:{persistSession:false}});
 const {data:{user},error:authError}=await auth.auth.getUser(token);
 if(authError||!user||user.is_anonymous)return json({error:"Sign in required"},401);
 const key=Deno.env.get("TAVILY_API_KEY");
 if(request.method==="GET")return json({ready:Boolean(key),source:"Indexed discovery",sites:10});
 if(!key)return json({error:"Search provider unavailable"},503);
 const db=createClient(url,admin,{auth:{persistSession:false}});
 const {data:profile,error:profileError}=await db.from("customer_profiles")
  .select("first_name,last_name,city,state,consent_to_search").eq("user_id",user.id).maybeSingle();
 if(profileError||!profile?.first_name||!profile?.last_name)return json({error:"Complete your profile"},400);
 if(!profile.consent_to_search)return json({error:"Authorize searches in My Profile"},403);
 const since=new Date(Date.now()-86400000).toISOString();
 const {data:recent,error:recentError}=await db.from("privacy_scans").select("id")
  .eq("user_id",user.id).gte("started_at",since).limit(1);
 if(recentError)return json({error:"Unable to check rate limit"},500);
 if(recent?.length)return json({error:"One scan every 24 hours is allowed during free testing"},429);
 const {data:sites,error:sitesError}=await db.from("supported_sites")
   .select("slug,name,domain,search_mode").order("slug");
 if(sitesError||!sites?.length)return json({error:"Sources unavailable"},503);
 const indexed=(sites as Site[]).filter(site=>site.search_mode==="indexed_discovery");
 if(!indexed.length)return json({error:"No indexed search sources available"},503);
 if(!await reserveBudget(db,indexed.length))return json({error:"Free monthly search allowance reached"},429);
 const {data:scan,error:scanError}=await db.from("privacy_scans")
  .insert({user_id:user.id,status:"running"}).select("id").single();
 if(scanError||!scan)return json({error:"Could not create scan"},500);
 try{
   const {data:previous,error:previousError}=await db.from("privacy_findings")
    .select("source_name,listing_url").eq("user_id",user.id);
   if(previousError)throw new Error("Could not fetch previous findings");
   const prior=new Set((previous||[]).map((item:{source_name:string;listing_url:string})=>item.source_name+"|"+item.listing_url));
   const outcomes:Awaited<ReturnType<typeof discover>>[]=[];
   for(let i=0;i<indexed.length;i+=3){
     const batch=await Promise.all(indexed.slice(i,i+3).map(site=>discover(site,profile as Profile,key)));
     outcomes.push(...batch);
   }
   const newFindings:{user_id:string;scan_id:string;source_name:string;listing_url:string;match_status:string}[]=[];
   const checks:{user_id:string;scan_id:string;site_slug:string;status:string;findings_count:number}[]=[];
   for(const item of outcomes){
     let newCount=0;
     for(const href of item.urls){
       const id=item.site.name+"|"+href;
       if(prior.has(id))continue;
       prior.add(id);newCount++;
       newFindings.push({user_id:user.id,scan_id:scan.id,source_name:item.site.name,
         listing_url:href,match_status:"possible"});
     }
     checks.push({user_id:user.id,scan_id:scan.id,site_slug:item.site.slug,
       status:item.status,findings_count:newCount});
   }
   for(const site of sites as Site[]){
     if(site.search_mode==="manual_only") checks.push({user_id:user.id,scan_id:scan.id,
       site_slug:site.slug,status:"manual_required",findings_count:0});
   }
   if(newFindings.length){
     const {error:writeError}=await db.from("privacy_findings").upsert(newFindings,
       {onConflict:"user_id,source_name,listing_url",ignoreDuplicates:true});
     if(writeError)throw new Error("Could not write findings");
   }
   const {error:coverageError}=await db.from("scan_source_results").insert(checks);
   if(coverageError)throw new Error("Could not write source coverage");
   const {error:doneError}=await db.from("privacy_scans")
    .update({status:"completed",completed_at:new Date().toISOString()}).eq("id",scan.id);
   if(doneError)throw new Error("Could not finalize scan");
   return json({status:"completed",scan_id:scan.id,possible_matches:newFindings.length,
     source_checks:checks.map(c=>({site:c.site_slug,status:c.status}))});
 }catch{
   await db.from("privacy_scans").update({status:"failed",completed_at:new Date().toISOString()}).eq("id",scan.id);
   return json({error:"Search could not be completed. Try again later."},502);
 }
});