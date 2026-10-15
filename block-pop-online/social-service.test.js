'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const create=require('./social-service');
const secret='L'.repeat(55), key='K'.repeat(48);
function mockResponse(data){return {ok:true,status:200,text:async()=>JSON.stringify(data)}}
const events=[];
const svc=create({origin:'https://example.supabase.co',anonKey:key,serverKey:secret,
 isAdmin:req=>req.headers.authorization==='Bearer administrator-session',
 fetcher:async (url,options)=>{
  assert.equal(url,'https://example.supabase.co/rest/v1/rpc/bp_social_api');
  const data=JSON.parse(options.body);assert.equal(data.p_key,secret);events.push(data);
  return mockResponse({ok:true,notices:[],codes:[],action:data.p_action,coins:50});
 }});
let server,base;
test('start mock HTTP server',async()=>{
 server=http.createServer((req,res)=>svc.handle(req,res,req.url).catch(()=>res.end('{}')));
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+server.address().port;
});
async function call(url,options){const res=await fetch(base+url,options);return {status:res.status,body:await res.json()}}
test('public news API is accessible without login',async()=>{
 const r=await call('/api/social/notices');assert.equal(r.status,200);assert.equal(r.body.action,'notices');
});
test('admin listing requires signed server token',async()=>{
 const r=await call('/api/social/admin/codes');assert.equal(r.status,401);
});
test('admin codes listing with token works',async()=>{
 const r=await call('/api/social/admin/codes',{headers:{Authorization:'Bearer administrator-session'}});
 assert.equal(r.status,200);assert.equal(r.body.action,'admin_codes');
});
test('redeem validates player and code',async()=>{
 const bad=await call('/api/social/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'BAD',playerId:'2'})});assert.equal(bad.status,400);
 const good=await call('/api/social/redeem',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code:'ABCDEF-123',playerId:'0123456789abcdef0123456789abcdef'})});
 assert.equal(good.status,200);assert.equal(good.body.coins,50);assert.equal(events.at(-1).p_action,'redeem');
});
test('unprivileged user cannot create announcement',async()=>{
 const r=await call('/api/social/admin/notices',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create'})});assert.equal(r.status,401);
});
test('admin creates announcements via Supabase RPC',async()=>{
 const r=await call('/api/social/admin/notices',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer administrator-session'},body:JSON.stringify({action:'create',title:'Event starts!',body:'Weekend bonus is here',important:true,startsAt:'2026-10-16T00:00:00Z',endsAt:'2026-11-16T00:00:00Z'})});
 assert.equal(r.status,200);assert.equal(events.at(-1).p_action,'admin_notice_write');
});
test('admin creates a code via Supabase RPC',async()=>{
 const r=await call('/api/social/admin/codes',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer administrator-session'},body:JSON.stringify({action:'create',coins:80,maxUses:25,startsAt:'2026-10-16T00:00:00Z',endsAt:'2026-11-16T00:00:00Z'})});
 assert.equal(r.status,200);assert.match(events.at(-1).p_payload.code,/^[A-F0-9]{12}$/);
});
test('cross-origin POST is blocked',async()=>{
 const r=await call('/api/social/redeem',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://evil.example'},body:'{}'});assert.equal(r.status,403);
});
test('bad admin dates rejected before DB call',async()=>{
 const r=await call('/api/social/admin/notices',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer administrator-session'},body:JSON.stringify({action:'create',title:'Test News',body:'Future News',startsAt:'2026-11-16T00:00:00Z',endsAt:'2026-10-16T00:00:00Z'})});assert.equal(r.status,400);
});
test('closing mock server',async()=>{await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()))});
