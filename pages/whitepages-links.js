const states = {
  alabama:'AL',alaska:'AK',arizona:'AZ',arkansas:'AR',california:'CA',colorado:'CO',connecticut:'CT',
  delaware:'DE',florida:'FL',georgia:'GA',hawaii:'HI',idaho:'ID',illinois:'IL',indiana:'IN',
  iowa:'IA',kansas:'KS',kentucky:'KY',louisiana:'LA',maine:'ME',maryland:'MD',
  massachusetts:'MA',michigan:'MI',minnesota:'MN',mississippi:'MS',missouri:'MO',
  montana:'MT',nebraska:'NE',nevada:'NV','new hampshire':'NH','new jersey':'NJ',
  'new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND',
  ohio:'OH',oklahoma:'OK',oregon:'OR',pennsylvania:'PA','rhode island':'RI',
  'south carolina':'SC','south dakota':'SD',tennessee:'TN',texas:'TX',utah:'UT',
  vermont:'VT',virginia:'VA',washington:'WA','west virginia':'WV',wisconsin:'WI',
  wyoming:'WY','district of columbia':'DC'
};
const stateCodes = new Set(Object.values(states));

function whitepagesUrl(text) {
  try {
    const u = new URL(text.trim());
    if (u.protocol !== 'https:' || !/^(www\.)?whitepages\.com$/i.test(u.hostname)) return null;
    return u;
  } catch {
    return null;
  }
}
export function checkoutRecordId(text) {
  const url = whitepagesUrl(text);
  if (!url || !/^\/checkout\/summary\/?$/i.test(url.pathname)) return null;
  const id = url.searchParams.get('wpId');
  return id && /^[a-z0-9]{6,40}$/i.test(id) ? id : null;
}
export function profileLink(text) {
  const url = whitepagesUrl(text);
  if (!url) return null;
  const segments = url.pathname.split('/').filter(Boolean);
  if (segments.length !== 4 || segments[0].toLowerCase() !== 'name') return null;
  if (!/^[a-z0-9-]+$/i.test(segments[1]) || !/^[a-z0-9-]+-[a-z]{2}$/i.test(segments[2])) return null;
  if (!/^[a-z0-9]{6,40}$/i.test(segments[3])) return null;
  return url.origin + url.pathname;
}
function slug(value) {
  return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/gi,'-').replace(/^-|-$/g,'');
}
export function candidateProfileLink({first_name,last_name,city,state},wpId) {
  if (!/^[a-z0-9]{6,40}$/i.test(wpId || '')) return null;
  const name = slug([first_name,last_name].filter(Boolean).join(' '));
  const place = slug(city);
  const original = String(state || '').trim();
  const code = original.length === 2 ? original.toUpperCase() : states[original.toLowerCase()];
  if (!name || !place || !stateCodes.has(code)) return null;
  return 'https://www.whitepages.com/name/' + name + '/' + place + '-' + code + '/' + wpId;
}
