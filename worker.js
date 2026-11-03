// AFAQ SYRIA — Cloudflare Worker API
// Bind a D1 database as DB. Set NOWPAYMENTS_API_KEY and NOWPAYMENTS_IPN_SECRET as Worker secrets.
// Protect /api/v1/* with Cloudflare Access on your custom domain. Leave /health and /api/payment/ipn public.
const cors = (request, env) => {
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.ALLOWED_ORIGIN || '').split(',').map(x=>x.trim()).filter(Boolean);
  const allow = allowed.includes(origin) ? origin : (allowed.length ? allowed[0] : (origin || '*'));
  return {'Access-Control-Allow-Origin':allow,'Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type,Authorization','Access-Control-Allow-Credentials':'true','Vary':'Origin'};
};
const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8',...headers}});
const corsJson=(data,status,request,env)=>json(data,status,cors(request,env));
const deepSort=value=>Array.isArray(value)?value.map(deepSort):value&&typeof value==='object'?Object.keys(value).sort().reduce((o,k)=>(o[k]=deepSort(value[k]),o),{}):value;
const hex=buf=>[...new Uint8Array(buf)].map(b=>b.toString(16).padStart(2,'0')).join('');
async function verifyIPN(raw,signature,secret){
 if(!signature||!secret)return false;
 let body;try{body=JSON.parse(raw)}catch(_){return false}
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-512'},false,['sign']);
 const signed=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(JSON.stringify(deepSort(body))));
 const expected=hex(signed);if(expected.length!==signature.length)return false;
 let diff=0;for(let i=0;i<expected.length;i++)diff|=expected.charCodeAt(i)^signature.toLowerCase().charCodeAt(i);return diff===0;
}
async function ensureTables(env){
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS afaq_records (record_type TEXT PRIMARY KEY, payload TEXT NOT NULL, updated_at TEXT NOT NULL)').run();
 await env.DB.prepare('CREATE TABLE IF NOT EXISTS afaq_payments (order_id TEXT PRIMARY KEY, invoice_id TEXT, invoice_url TEXT, amount REAL NOT NULL, currency TEXT NOT NULL, pay_currency TEXT, status TEXT NOT NULL, payload TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)').run();
}
async function handle(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors(request,env)});
 if(path==='/health'&&request.method==='GET')return corsJson({ok:true,service:'AFAQ SYRIA API',time:new Date().toISOString()},200,request,env);
 if(path==='/api/payment/ipn'&&request.method==='POST'){
  const raw=await request.text();
  const valid=await verifyIPN(raw,request.headers.get('x-nowpayments-sig'),env.NOWPAYMENTS_IPN_SECRET);
  if(!valid)return json({ok:false,error:'Invalid IPN signature'},401);
  const event=JSON.parse(raw),orderId=String(event.order_id||'');
  if(orderId){await ensureTables(env);await env.DB.prepare('UPDATE afaq_payments SET status=?, payload=?, updated_at=? WHERE order_id=?').bind(String(event.payment_status||event.invoice_status||'unknown'),JSON.stringify(event),new Date().toISOString(),orderId).run();}
  return json({ok:true});
 }
 if(path==='/api/payment/create'&&request.method==='POST'){
  if(!env.NOWPAYMENTS_API_KEY||!env.NOWPAYMENTS_IPN_SECRET)return corsJson({error:'Payment provider secrets are not configured'},503,request,env);
  let body;try{body=await request.json()}catch(_){return corsJson({error:'Invalid JSON'},400,request,env)}
  const amount=Number(body.amount),currency=String(body.currency||'usd').toLowerCase(),payCurrency=String(body.pay_currency||'usdttrc20').toLowerCase();
  if(!Number.isFinite(amount)||amount<=0||amount>1000000)return corsJson({error:'Invalid amount'},400,request,env);
  if(!/^[a-z0-9]{2,15}$/.test(currency)||!/^[a-z0-9]{2,20}$/.test(payCurrency))return corsJson({error:'Invalid currency'},400,request,env);
  const orderId='AFQ-'+crypto.randomUUID();
  const origin=url.origin;
  const payload={price_amount:amount,price_currency:currency,pay_currency:payCurrency,order_id:orderId,order_description:String(body.description||'AFAQ SYRIA invoice').slice(0,200),ipn_callback_url:origin+'/api/payment/ipn',success_url:String(body.success_url||''),cancel_url:String(body.cancel_url||'')};
  for(const k of ['success_url','cancel_url'])if(!payload[k])delete payload[k];
  const provider=await fetch('https://api.nowpayments.io/v1/invoice',{method:'POST',headers:{'x-api-key':env.NOWPAYMENTS_API_KEY,'Content-Type':'application/json'},body:JSON.stringify(payload)});
  const result=await provider.json().catch(()=>({}));
  if(!provider.ok)return corsJson({error:result.message||result.error||'NOWPayments invoice creation failed',provider_status:provider.status},502,request,env);
  await ensureTables(env);
  await env.DB.prepare('INSERT INTO afaq_payments (order_id,invoice_id,invoice_url,amount,currency,pay_currency,status,payload,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)').bind(orderId,String(result.id||''),String(result.invoice_url||''),amount,currency,payCurrency,'waiting',JSON.stringify(result),new Date().toISOString(),new Date().toISOString()).run();
  return corsJson({ok:true,order_id:orderId,invoice_id:result.id,invoice_url:result.invoice_url,status:'waiting'},200,request,env);
 }
 // All remaining endpoints are admin endpoints: protect /api/v1/* using Cloudflare Access.
 if(path==='/api/v1/sync'&&request.method==='POST'){
  let body;try{body=await request.json()}catch(_){return corsJson({error:'Invalid JSON'},400,request,env)}
  if(!body.records||typeof body.records!=='object'||Array.isArray(body.records))return corsJson({error:'records object is required'},400,request,env);
  await ensureTables(env);let saved=0;
  for(const [type,value] of Object.entries(body.records)){
   if(!/^[a-zA-Z0-9_-]{1,50}$/.test(type))continue;
   const payload=JSON.stringify(value);
   if(payload.length>900000)return corsJson({error:'Record group too large: '+type},413,request,env);
   await env.DB.prepare('INSERT INTO afaq_records(record_type,payload,updated_at) VALUES(?,?,?) ON CONFLICT(record_type) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').bind(type,payload,new Date().toISOString()).run();saved++;
  }
  return corsJson({ok:true,saved},200,request,env);
 }
 if(path==='/api/v1/records'&&request.method==='GET'){
  await ensureTables(env);const type=url.searchParams.get('type');
  const result=type?await env.DB.prepare('SELECT record_type,payload,updated_at FROM afaq_records WHERE record_type=?').bind(type).first():null;
  if(type)return corsJson(result?{type:result.record_type,data:JSON.parse(result.payload),updated_at:result.updated_at}:{error:'Not found'},result?200:404,request,env);
  const rows=await env.DB.prepare('SELECT record_type,payload,updated_at FROM afaq_records ORDER BY record_type').all();
  return corsJson({records:(rows.results||[]).map(x=>({type:x.record_type,data:JSON.parse(x.payload),updated_at:x.updated_at}))},200,request,env);
 }
 if(path==='/api/v1/payments'&&request.method==='GET'){
  await ensureTables(env);const rows=await env.DB.prepare('SELECT order_id,invoice_id,invoice_url,amount,currency,pay_currency,status,created_at,updated_at FROM afaq_payments ORDER BY created_at DESC LIMIT 100').all();
  return corsJson({payments:rows.results||[]},200,request,env);
 }
 return corsJson({error:'Not found'},404,request,env);
}
export default {async fetch(request,env){try{return await handle(request,env)}catch(e){return json({error:'Internal server error',detail:env.DEBUG==='true'?String(e):undefined},500)}}};
