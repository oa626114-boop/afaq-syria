const COMPANY = "AFAQ SYRIA";
const ALLOWED_CURRENCIES = new Set(["usdttrc20", "usdterc20", "usdtbsc"]);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-internal-token",
  "Content-Type": "application/json; charset=utf-8"
};
const json = (data, status=200) => new Response(JSON.stringify(data), {status, headers:CORS});
const hex = bytes => [...new Uint8Array(bytes)].map(b=>b.toString(16).padStart(2,"0")).join("");
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") return Object.keys(value).sort().reduce((o,k)=>(o[k]=stable(value[k]),o),{});
  return value;
}
async function verifyIPN(rawBody, signature, secret) {
  if (!signature || !secret) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), {name:"HMAC",hash:"SHA-512"}, false, ["sign"]);
  const parsed = JSON.parse(rawBody);
  const signed = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(JSON.stringify(stable(parsed))));
  const expected = hex(signed);
  if (expected.length !== signature.length) return false;
  let diff = 0; for (let i=0;i<expected.length;i++) diff |= expected.charCodeAt(i) ^ signature.toLowerCase().charCodeAt(i);
  return diff === 0;
}
export default {
 async fetch(request, env) {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null,{headers:CORS});
  if (url.pathname === "/" || url.pathname === "/health") {
    return json({success:true,company:COMPANY,service:"AFAQ SYRIA payment API",api_key_configured:!!env.NOWPAYMENTS_API_KEY,ipn_secret_configured:!!env.NOWPAYMENTS_IPN_SECRET,kv_configured:!!env.PAYMENTS});
  }
  if (url.pathname === "/create-payment" && request.method === "POST") {
    if (!env.NOWPAYMENTS_API_KEY) return json({success:false,error:"NOWPAYMENTS_API_KEY_MISSING"},500);
    let body; try { body=await request.json(); } catch { return json({success:false,error:"INVALID_JSON"},400); }
    const amount=Number(body.amount), currency=String(body.currency||"usdttrc20").toLowerCase();
    if (!Number.isFinite(amount)||amount<1||amount>10000) return json({success:false,error:"AMOUNT_MUST_BE_BETWEEN_1_AND_10000_USD"},400);
    if (!ALLOWED_CURRENCIES.has(currency)) return json({success:false,error:"UNSUPPORTED_PAYMENT_CURRENCY"},400);
    const orderId=crypto.randomUUID();
    try {
      const upstream=await fetch("https://api.nowpayments.io/v1/payment",{
        method:"POST",headers:{"x-api-key":env.NOWPAYMENTS_API_KEY,"Content-Type":"application/json"},
        body:JSON.stringify({price_amount:amount,price_currency:"usd",pay_currency:currency,order_id:orderId,order_description:`${COMPANY} order ${orderId}`})
      });
      const result=await upstream.json();
      if(!upstream.ok) return json({success:false,error:"NOWPAYMENTS_PAYMENT_REJECTED",provider_status:upstream.status,details:result},502);
      const record={order_id:orderId,payment_id:String(result.payment_id),payment_status:result.payment_status||"waiting",pay_address:result.pay_address||null,pay_amount:result.pay_amount??null,pay_currency:result.pay_currency||currency,created_at:new Date().toISOString()};
      if (env.PAYMENTS) await env.PAYMENTS.put(`payment:${record.payment_id}`,JSON.stringify(record),{expirationTtl:60*60*24*30});
      return json({success:true,company:COMPANY,payment:record});
    } catch(e) { return json({success:false,error:"NOWPAYMENTS_CONNECTION_FAILED"},502); }
  }
  if (url.pathname === "/payment-status" && request.method === "GET") {
    if (!env.NOWPAYMENTS_API_KEY) return json({success:false,error:"NOWPAYMENTS_API_KEY_MISSING"},500);
    const id=url.searchParams.get("payment_id"); if(!id) return json({success:false,error:"PAYMENT_ID_REQUIRED"},400);
    try {
      const upstream=await fetch(`https://api.nowpayments.io/v1/payment/${encodeURIComponent(id)}`,{headers:{"x-api-key":env.NOWPAYMENTS_API_KEY}});
      const result=await upstream.json(); if(!upstream.ok) return json({success:false,error:"PAYMENT_LOOKUP_FAILED"},502);
      if(env.PAYMENTS){const key=`payment:${id}`,old=await env.PAYMENTS.get(key,"json");if(old){old.payment_status=result.payment_status||old.payment_status;old.updated_at=new Date().toISOString();await env.PAYMENTS.put(key,JSON.stringify(old),{expirationTtl:60*60*24*30});}}
      return json({success:true,payment_id:String(result.payment_id),payment_status:result.payment_status,actually_paid:result.actually_paid??null, pay_amount:result.pay_amount??null,pay_currency:result.pay_currency??null});
    } catch { return json({success:false,error:"NOWPAYMENTS_CONNECTION_FAILED"},502); }
  }
  if (url.pathname === "/ipn" && request.method === "POST") {
    if(!env.NOWPAYMENTS_IPN_SECRET) return json({success:false,error:"IPN_SECRET_MISSING"},500);
    const raw=await request.text(),signature=request.headers.get("x-nowpayments-sig");
    let payload;try{payload=JSON.parse(raw)}catch{return json({success:false,error:"INVALID_JSON"},400);}
    let valid=false;try{valid=await verifyIPN(raw,signature,env.NOWPAYMENTS_IPN_SECRET)}catch{}
    if(!valid) return json({success:false,error:"INVALID_IPN_SIGNATURE"},401);
    const id=String(payload.payment_id||"");if(!id)return json({success:false,error:"PAYMENT_ID_MISSING"},400);
    if(env.PAYMENTS){const key=`payment:${id}`,old=await env.PAYMENTS.get(key,"json");const next={...(old||{}),payment_id:id,payment_status:payload.payment_status||"unknown",actually_paid:payload.actually_paid??null,updated_at:new Date().toISOString(),ipn_received:true};await env.PAYMENTS.put(key,JSON.stringify(next),{expirationTtl:60*60*24*30});}
    return json({success:true,received:true});
  }
  return json({success:false,error:"NOT_FOUND"},404);
 }
};