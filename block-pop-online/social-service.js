'use strict';
/** Server-backed gift codes and news bulletin for Block Pop! ONLINE.
 * Administrative access is gated by the existing signed admin session.
 * The PostgreSQL RPC secret stays on Render; never included in browser responses.
 */
const crypto=require('node:crypto');
module.exports=function createSocialService({
 isAdmin=()=>false,
 origin=process.env.BLOCKPOP_SUPABASE_URL||'',
 anonKey=process.env.BLOCKPOP_SUPABASE_ANON_KEY||'',
 serverKey=process.env.BLOCKPOP_EVENTS_SERVER_KEY||'',
 fetcher=globalThis.fetch
}={}){
 const enabled=/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(origin)&&anonKey.length>20&&serverKey.length>=48;
 const endpoint=origin.replace(/\/$/,'')+'/rest/v1/rpc/bp_social_api';
 const limits=new Map();
 const reply=(res,code,obj)=>{
  const bytes=Buffer.from(JSON.stringify(obj),'utf8');res.writeHead(code,{
   'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length,
   'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
  });res.end(bytes);
 };
 function cors(req,res){
  const originHeader=req.headers.origin,host=String(req.headers.host||'');
  const safe=!originHeader||originHeader==='null'||originHeader==='https://block-pop-online.onrender.com'||
   /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(originHeader)||(()=>{try{const url=new URL(originHeader);return url.protocol==='https:'&&url.host===host;}catch{return false}})();
  if(!safe)return false;
  res.setHeader('Access-Control-Allow-Origin',originHeader||'*');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Vary','Origin');return true;
 }
 function rateLimit(req,category,max,windowMs){
  const raw=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim().slice(0,80);
  const key=crypto.createHash('sha256').update(category+'|'+raw).digest('hex').slice(0,24);
  const now=Date.now();let old=limits.get(key);
  if(!old||old.until<now){old={until:now+windowMs,count:0};limits.set(key,old)}
  if(limits.size>4000)for(const [k,v] of limits)if(v.until<now)limits.delete(k);
  return ++old.count<=max;
 }
 async function parse(req,max=4200){
  if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))throw Object.assign(Error('JSON形式で送信してね'),{code:415});
  let size=0,body='';for await(const chunk of req){size+=chunk.length;if(size>max)throw Object.assign(Error('データが大きすぎるよ'),{code:413});body+=chunk.toString('utf8')}
  let data;try{data=JSON.parse(body)}catch{throw Object.assign(Error('JSONの形式を確認してね'),{code:400})}
  if(!data||typeof data!=='object'||Array.isArray(data))throw Object.assign(Error('データの形式を確認してね'),{code:400});
  return data;
 }
 async function rpc(action,payload){
  if(!enabled)throw Object.assign(Error('コード・お知らせサーバーの設定が必要だよ'),{code:503});
  const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),16000);
  try{
   const upstream=await fetcher(endpoint,{method:'POST',signal:controller.signal,
    headers:{apikey:anonKey,Authorization:'Bearer '+anonKey,'Content-Type':'application/json'},
    body:JSON.stringify({p_action:action,p_payload:payload,p_key:serverKey})});
   const raw=await upstream.text();let data;try{data=JSON.parse(raw)}catch{data=null}
   if(!upstream.ok){
    // PostgREST exception text must not leak any secret or database details.
    const message=String(data?.message||'データベースのエラー').slice(0,150);
    if(upstream.status>=500||/authorized|database|syntax|permission|schema|rpc|function|relation/i.test(message))
     throw Object.assign(Error('データベースの接続・設定を確認してね'),{code:503});
    throw Object.assign(Error(message),{code:400});
   }
   if(!data||data.ok!==true)throw Object.assign(Error('保存結果を確認できなかったよ'),{code:503});
   return data;
  }finally{clearTimeout(timeout)}
 }
 function dates(body){
  const startsAt=String(body.startsAt||''),endsAt=String(body.endsAt||'');
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(startsAt)||
     !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(endsAt)||
     !(Date.parse(startsAt)<Date.parse(endsAt))||!(Date.parse(endsAt)-Date.parse(startsAt)<=366*86400000))
      throw Object.assign(Error('開始・終了日時を確認してね'),{code:400});
  return{startsAt,endsAt};
 }
 function uuid(value){return typeof value==='string'&&/^[0-9a-f-]{36}$/.test(value)}
 async function handle(req,res,path){
  if(!path.startsWith('/api/social/'))return false;
  if(!cors(req,res)){reply(res,403,{error:'許可されていない接続元です'});return true;}
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return true;}
  const admin=path.startsWith('/api/social/admin/');
  if(admin&&!isAdmin(req)){reply(res,401,{error:'管理者ログインが必要だよ'});return true;}
  if(!enabled){reply(res,503,{error:'お知らせ・コードのデータベース設定がないよ'});return true;}
  try{
   if(req.method==='GET'){
    if(path==='/api/social/notices')return reply(res,200,await rpc('notices',{})),true;
    if(path==='/api/social/admin/notices')return reply(res,200,await rpc('admin_notices',{})),true;
    if(path==='/api/social/admin/codes')return reply(res,200,await rpc('admin_codes',{})),true;
    reply(res,404,{error:'この機能は見つからないよ'});return true;
   }
   if(req.method!=='POST'){reply(res,405,{error:'POSTで送信してね'});return true;}
   const restricted=admin?'admin':path==='/api/social/redeem'?'redeem':'public';
   if(!rateLimit(req,restricted,admin?24:restricted==='redeem'?12:20,admin?60000:3600000)){
    reply(res,429,{error:'入力が多すぎるよ。時間をおいて試してね'});return true;
   }
   const body=await parse(req,admin?6000:1400);
   if(path==='/api/social/redeem'){
    const code=String(body.code||'').trim().toUpperCase();
    if(!/^[A-Z0-9-]{6,24}$/.test(code)||!/^[a-f0-9]{32}$/.test(body.playerId||''))
      throw Object.assign(Error('コードかプレイヤーIDを確認してね'),{code:400});
    reply(res,200,await rpc('redeem',{code,playerId:body.playerId}));return true;
   }
   if(admin&&(path==='/api/social/admin/codes'||path==='/api/social/admin/notices')){
    const action=String(body.action||'');
    if(!['create','edit','stop'].includes(action))throw Object.assign(Error('操作が正しくないよ'),{code:400});
    if(action!=='create'&&!uuid(body.id))throw Object.assign(Error('編集対象のIDが正しくないよ'),{code:400});
    if(action==='stop')return reply(res,200,await rpc(path.endsWith('codes')?'admin_code_write':'admin_notice_write',{action,id:body.id})),true;
    const time=dates(body);
    if(path.endsWith('codes')){
     const code=String(body.code||'').trim().toUpperCase()||crypto.randomBytes(6).toString('hex').toUpperCase();
     if(!/^[A-Z0-9-]{6,24}$/.test(code)||!Number.isInteger(body.coins)||body.coins<1||body.coins>1000||
       !Number.isInteger(body.maxUses)||body.maxUses<1||body.maxUses>10000)
       throw Object.assign(Error('コード・コイン・配布人数を確認してね'),{code:400});
     reply(res,200,await rpc('admin_code_write',{action,id:body.id,code,coins:body.coins,maxUses:body.maxUses,
       note:String(body.note||'').trim().slice(0,80),...time}));return true;
    }
    const title=String(body.title||'').trim(),msg=String(body.body||'').trim();
    if(title.length<2||title.length>80||msg.length<2||msg.length>600||/[<>\r\n\u0000-\u001f]/.test(title)||/[<>]/.test(msg))
     throw Object.assign(Error('お知らせのタイトル・本文を確認してね'),{code:400});
    reply(res,200,await rpc('admin_notice_write',{action,id:body.id,title,body:msg,important:body.important===true,...time}));return true;
   }
   reply(res,404,{error:'APIが見つからないよ'});return true;
  }catch(err){const code=[400,401,403,405,413,415,429,503].includes(err.code)?err.code:503;
   reply(res,code,{error:code===503?'サーバーへ接続できないよ。あとで試してね':String(err.message||'入力を確認してね').slice(0,130)});return true;}
 }
 return{handle,enabled,rpc};
};
