// Hosted preview uses fictional, tab-local state. The live app uses its server.
import { sources } from './sources.js';

const empty = () => ({ demo:true, hosted:true, verified:false, pending:false, listings:[] });
let workspace = empty();
export async function demoRequest(_url, options) {
  const input = options?.body ? JSON.parse(options.body) : {};
  if (input.action==='delete') workspace=empty();
  if (input.action==='demo') {
    workspace = {
      ...empty(),verified:true,
      listings:sources.map((source,index)=>({
        id:source.id, source:source.id, url:'https://example.invalid/demo/'+source.id,
        status:'Needs Review', confidence:index?'Possible':'Likely',
        evidence:index?['Name','City']:['Name','Age','Phone ending in 0100']
      }))
    };
  }
  const listing=workspace.listings.find(item=>item.id===input.id);
  if (listing?.status==='Needs Review') {
    if (input.action==='confirm') listing.status='Ready to Submit';
    if (input.action==='dismiss') workspace.listings=workspace.listings.filter(item=>item.id!==listing.id);
  }
  if (input.action==='submit') {
    if (!input.agree || !input.ids?.length) return Response.json({error:'Select listings and authorize the request.'},{status:400});
    for (const item of workspace.listings) {
      if (item.status==='Ready to Submit' && input.ids.includes(item.id)) {
        item.status='Submitted';
        item.submittedAt=new Date().toISOString();
        item.reference='DEMO-'+item.id.toUpperCase();
      }
    }
  }
  if (input.action==='recheck' && listing?.status==='Submitted') {
    listing.status='Removal Verified';
    listing.checkedAt=new Date().toISOString();
  }
  return Response.json(workspace);
}
