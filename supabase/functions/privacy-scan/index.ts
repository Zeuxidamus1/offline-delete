import { createClient } from "npm:@supabase/supabase-js@2.119.2";

const allowedOrigin = "https://zeuxidamus1.github.io";
const cors = {
  "Access-Control-Allow-Origin": allowedOrigin,
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Vary": "Origin"
};
function json(body: unknown, status=200) {
  return new Response(JSON.stringify(body), { status, headers: {...cors, "Content-Type":"application/json", "Cache-Control":"no-store"} });
}
Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, {status:204,headers:cors});
  if (!["GET","POST"].includes(request.method)) return json({error:"Method not allowed"},405);
  const token = request.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");
  if (!token) return json({error:"Sign in required"},401);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const adminKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anon || !adminKey) return json({error:"Scanning service unavailable"},503);
  const authClient = createClient(url,anon,{auth:{persistSession:false}});
  const {data:{user},error:authError} = await authClient.auth.getUser(token);
  if (authError || !user || user.is_anonymous) return json({error:"Sign in required"},401);
  const tavily = Deno.env.get("TAVILY_API_KEY");
  if (request.method === "GET") return json({ready:Boolean(tavily),source:"Whitepages"});
  if (!tavily) return json({error:"Scanning provider has not been connected yet"},503);
  const db = createClient(url,adminKey,{auth:{persistSession:false}});
  const {data:profile,error:profileError} = await db.from("customer_profiles")
    .select("first_name,middle_name,last_name,city,state,consent_to_search")
    .eq("user_id",user.id).maybeSingle();
  if (profileError) return json({error:"Unable to load profile"},500);
  if (!profile?.first_name || !profile?.last_name) return json({error:"Complete your profile before scanning"},400);
  if (!profile.consent_to_search) return json({error:"Enable search authorization in My Profile"},403);
  const since = new Date(Date.now()-24*60*60*1000).toISOString();
  const {data:recent,error:recentError} = await db.from("privacy_scans").select("id")
    .eq("user_id",user.id).gte("started_at",since).limit(1);
  if (recentError) return json({error:"Unable to check scan limits"},500);
  if (recent?.length) return json({error:"One scan per 24 hours is allowed during testing"},429);
  const {data:scan,error:insertError} = await db.from("privacy_scans")
    .insert({user_id:user.id,status:"running"}).select("id").single();
  if (insertError || !scan) return json({error:"Unable to start scan"},500);
  try {
    const query = ['"'+profile.first_name+' '+profile.last_name+'"',
      profile.city ? '"'+profile.city+'"' : "",
      profile.state ? '"'+profile.state+'"' : "",
      'site:whitepages.com'].filter(Boolean).join(" ");
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),18000);
    let response: Response;
    try {
      response = await fetch("https://api.tavily.com/search",{
        method:"POST",
        headers:{"Content-Type":"application/json","Authorization":"Bearer "+tavily},
        body:JSON.stringify({query,search_depth:"basic",max_results:8,include_domains:["whitepages.com"],include_answer:false,include_raw_content:false}),
        signal:controller.signal
      });
    } finally {clearTimeout(timer);}
    if (!response.ok) throw new Error("Search provider unavailable");
    const payload = await response.json();
    if (!Array.isArray(payload.results)) throw new Error("Unexpected search provider response");
    const {data:priorFindings,error:priorError} = await db.from("privacy_findings")
      .select("listing_url").eq("user_id",user.id);
    if (priorError) throw new Error("Unable to check previous findings");
    const priorUrls = new Set((priorFindings || []).map((item:{listing_url:string})=>item.listing_url));
    const deduped = new Set<string>();
    const findings:{user_id:string;scan_id:string;source_name:string;listing_url:string;match_status:string}[]=[];
    for (const item of payload.results) {
      if (typeof item.url !== "string") continue;
      let resultUrl: URL;
      try {resultUrl=new URL(item.url);} catch {continue;}
      if (resultUrl.protocol !== "https:" || !/(^|\.)whitepages\.com$/i.test(resultUrl.hostname)) continue;
      const segments = resultUrl.pathname.split("/").filter(Boolean);
      // Search-result URLs are not accepted by the Whitepages suppression form.
      if (segments.length !== 4 || segments[0].toLowerCase() !== "name" || !/^[a-z0-9]+$/i.test(segments[3])) continue;
      if (deduped.has(resultUrl.href) || priorUrls.has(resultUrl.href)) continue;
      let pathText = resultUrl.pathname;
      try { pathText = decodeURIComponent(pathText); } catch { /* keep encoded path */ }
      const combined = [item.title,item.content,pathText].filter(x=>typeof x==="string").join(" ").toLowerCase();
      if (!combined.includes(profile.first_name.toLowerCase()) || !combined.includes(profile.last_name.toLowerCase())) continue;
      deduped.add(resultUrl.href);
      findings.push({user_id:user.id,scan_id:scan.id,source_name:"Whitepages",listing_url:resultUrl.href,match_status:"possible"});
    }
    if (findings.length) {
      const {error:writeError}=await db.from("privacy_findings").insert(findings);
      if (writeError) throw new Error("Unable to store findings");
    }
    const {error:doneError}=await db.from("privacy_scans").update({status:"completed",completed_at:new Date().toISOString()}).eq("id",scan.id);
    if (doneError) throw new Error("Unable to finalize scan");
    return json({scan_id:scan.id,status:"completed",possible_matches:findings.length});
  } catch {
    await db.from("privacy_scans").update({status:"failed",completed_at:new Date().toISOString()}).eq("id",scan.id);
    return json({error:"The search could not be completed. Please try again later."},502);
  }
});
