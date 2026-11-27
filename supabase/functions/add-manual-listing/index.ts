import { createClient } from "npm:@supabase/supabase-js@2.119.2";
const cors={"Access-Control-Allow-Origin":"https://zeuxidamus1.github.io","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST,OPTIONS"};
const reply=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status,headers:{...cors,"Content-Type":"application/json","Cache-Control":"no-store"}});
Deno.serve(async request=>{
 if(request.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(request.method!=="POST")return reply({error:"Method not allowed"},405);
 const token=request.headers.get("authorization")?.replace(/^Bearer\s+/i,"");
 if(!token)return reply({error:"Sign in required"},401);
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_ANON_KEY"),service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key||!service)return reply({error:"Service unavailable"},503);
 const auth=createClient(url,key,{auth:{persistSession:false}});
 const {data:{user},error}=await auth.auth.getUser(token);
 if(error||!user||user.is_anonymous)return reply({error:"Sign in required"},401);
 let payload:{site_slug?:string;listing_url?:string};
 try{payload=await request.json();}catch{return reply({error:"Invalid request"},400);}
 const slug=String(payload.site_slug||"");
 const input=String(payload.listing_url||"").trim();
 if(!/^[a-z0-9-]{2,60}$/.test(slug)||input.length>1800)return reply({error:"Invalid listing"},400);
 const db=createClient(url,service,{auth:{persistSession:false}});
 const {data:profile}=await db.from("customer_profiles").select("consent_to_search").eq("user_id",user.id).maybeSingle();
 if(!profile?.consent_to_search)return reply({error:"Authorize searches in My Profile"},403);
 const {data:site,error:siteError}=await db.from("supported_sites").select("name,domain").eq("slug",slug).single();
 if(siteError||!site)return reply({error:"Unknown site"},400);
 let link:URL;
 try{link=new URL(input);}catch{return reply({error:"Enter a valid URL"},400);}
 const domain=site.domain.toLowerCase(),host=link.hostname.toLowerCase();
 if(link.protocol!=="https:"||!(host===domain||host==="www."+domain)||link.username||link.password){
   return reply({error:"The URL must be an HTTPS link from the selected site"},400);
 }
 link.hash="";
 const {count}=await db.from("privacy_findings").select("id",{count:"exact",head:true}).eq("user_id",user.id);
 if((count||0)>=100)return reply({error:"Maximum of 100 saved findings"},429);
 const {data:existing}=await db.from("privacy_findings").select("id").eq("user_id",user.id)
   .eq("source_name",site.name).eq("listing_url",link.href).maybeSingle();
 if(existing)return reply({finding_id:existing.id,already_saved:true});
 const {data:finding,error:insertError}=await db.from("privacy_findings")
  .insert({user_id:user.id,scan_id:null,source_name:site.name,listing_url:link.href,match_status:"possible"})
  .select("id").single();
 if(insertError||!finding)return reply({error:"Could not save listing"},500);
 return reply({finding_id:finding.id,already_saved:false});
});