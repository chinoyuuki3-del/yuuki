'use strict';
/** Block Pop! account proxy: Supabase Auth + owner-only RLS cloud save.
 *  No service-role key; passwords are never persisted or logged by this app.
 */
const crypto=require('node:crypto');
const ACCOUNT_PREFIX='/api/account/';
module.exports=function createAccountService({url=process.env.BLOCKPOP_SUPABASE_URL||'',key=process.env.BLOCKPOP_SUPABASE_ANON_KEY||''}={}){
 const enabled=/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)&&key.length>20;
 const base=url.replace(/\/$/,'');
 const rate=new Map();
 function ipKey(req){const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim();return crypto.createHash('sha256').update(forwarded||req.socket.remoteAddress||'unknown').digest('hex').slice(0,20);}
 function limited(req,route,max,windowMs){
  const now=Date.now(),k=ipKey(req)+':'+route,entry=rate.get(k);
  if(!entry||now-entry.since>windowMs){rate.set(k,{since:now,count:1});return false;}
  entry.count++;return entry.count>max;
 }
 function reply(res,code,json){const body=JSON.stringify(json);res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':Buffer.byteLength(body)});res.end(body);}
 function secureHeaders(req,res){
  const origin=req.headers.origin;
  const host=String(req.headers.host||'');
  const allowed=!origin||origin==='null'||origin==='https://block-pop-online.onrender.com'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)||(()=>{try{return new URL(origin).host===host&&new URL(origin).protocol==='https:';}catch{return false;}})();
  if(!allowed){reply(res,403,{error:'許可されていない接続元です'});return false;}
  if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Vary','Origin');return true;
 }
 async function readBody(req,limit=70000){
  let total=0,chunks=[];
  for await (const b of req){total+=b.length;if(total>limit)throw Object.assign(Error('too big'),{status:413});chunks.push(b);}
  try{return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw Object.assign(Error('bad JSON'),{status:400});}
 }
 async function remote(path,{method='GET',data,bearer=key,prefer}={}){
  const ctrl=new AbortController(),timeout=setTimeout(()=>ctrl.abort(),16000);
  try{
   const res=await fetch(base+path,{method,signal:ctrl.signal,headers:{'apikey':key,'Authorization':'Bearer '+bearer,...(data?{'Content-Type':'application/json'}:{}),...(prefer?{'Prefer':prefer}:{})},...(data?{body:JSON.stringify(data)}:{})});
   const text=await res.text();let json;try{json=JSON.parse(text)}catch{json={}};
   if(!res.ok){const error=String(json.msg||json.error_description||json.message||json.error||'クラウドサーバーの処理に失敗').slice(0,140);throw Object.assign(Error(error),{status:res.status});}
   return json;
  }finally{clearTimeout(timeout);}
 }
 async function validUser(req){
  const match=/^Bearer\s+([A-Za-z0-9._-]+)$/i.exec(String(req.headers.authorization||''));
  if(!match||match[1].length>2500)throw Object.assign(Error('ログインが必要だよ'),{status:401});
  const user=await remote('/auth/v1/user',{bearer:match[1]});
  if(!user?.id||!/^[0-9a-f-]{36}$/.test(user.id))throw Object.assign(Error('セッションが無効です'),{status:401});
  return{user,token:match[1]};
 }
 function safeNickname(x){return String(x||'Player').trim().replace(/[<>\r\n\u0000-\u001f]/g,'').slice(0,20)||'Player';}
 async function profile(user,token){
  const rows=await remote('/rest/v1/bp_profiles?select=nickname%2Cupdated_at&user_id=eq.'+encodeURIComponent(user.id),{bearer:token});
  return rows?.[0]||null;
 }
 async function handle(req,res,path){
  if(!path.startsWith(ACCOUNT_PREFIX))return false;
  if(!secureHeaders(req,res))return true;
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return true;}
  if(path==='/api/account/status')return reply(res,200,{enabled,provider:'Supabase',cloudSave:enabled}),true;
  if(!enabled)return reply(res,503,{error:'アカウント用データベースを設定中だよ。ゲスト対戦は引き続き遊べるよ'}),true;
  try{
   if(path==='/api/account/register'&&req.method==='POST'){
    if(limited(req,'register',6,30*60*1000))return reply(res,429,{error:'登録回数が多いため、少し時間をおいてね'}),true;
    const data=await readBody(req,3000);const email=String(data.email||'').trim().toLowerCase(),password=String(data.password||''),nickname=safeNickname(data.nickname);
    if(email.length>160||!/^\S+@\S+\.\S+$/.test(email)||password.length<8||password.length>128)return reply(res,400,{error:'正しいメールアドレスと8文字以上のパスワードを入力してね'}),true;
    const obj=await remote('/auth/v1/signup',{method:'POST',data:{email,password,data:{nickname}}});
    return reply(res,200,{ok:true,needsConfirmation:!obj.access_token,session:obj.access_token?{
     accessToken:obj.access_token,refreshToken:obj.refresh_token,expiresIn:obj.expires_in,userId:obj.user?.id,nickname
    }:null,message:obj.access_token?'アカウントを作成したよ':'確認メールのリンクを開いてからログインしてね'}),true;
   }
   if(path==='/api/account/login'&&req.method==='POST'){
    if(limited(req,'login',35,10*60*1000))return reply(res,429,{error:'試行が多すぎるよ。しばらくしてからね'}),true;
    const data=await readBody(req,3000);
    const obj=await remote('/auth/v1/token?grant_type=password',{method:'POST',data:{email:String(data.email||'').trim().toLowerCase(),password:String(data.password||'')}});
    const username=obj.user?.user_metadata?.nickname||'Player';
    return reply(res,200,{ok:true,session:{accessToken:obj.access_token,refreshToken:obj.refresh_token,expiresIn:obj.expires_in,userId:obj.user?.id,nickname:safeNickname(username)}}),true;
   }
   if(path==='/api/account/refresh'&&req.method==='POST'){
    const body=await readBody(req,3000);const token=String(body.refreshToken||'');if(!token||token.length>2000)return reply(res,400,{error:'更新情報がないよ'}),true;
    const obj=await remote('/auth/v1/token?grant_type=refresh_token',{method:'POST',data:{refresh_token:token}});
    return reply(res,200,{ok:true,session:{accessToken:obj.access_token,refreshToken:obj.refresh_token,expiresIn:obj.expires_in,userId:obj.user?.id,nickname:safeNickname(obj.user?.user_metadata?.nickname)}}),true;
   }
   if(path==='/api/account/me'&&req.method==='GET'){
    const {user,token}=await validUser(req);let p=await profile(user,token);
    if(!p){
     const name=safeNickname(user.user_metadata?.nickname);
     await remote('/rest/v1/bp_profiles?on_conflict=user_id',{method:'POST',bearer:token,data:{user_id:user.id,nickname:name},prefer:'resolution=ignore-duplicates,return=minimal'});
     p=await profile(user,token);
    }
    return reply(res,200,{ok:true,user:{id:user.id,nickname:p?.nickname||'Player',emailConfirmed:!!user.email_confirmed_at}}),true;
   }
   if(path==='/api/account/nickname'&&req.method==='POST'){
    const {user,token}=await validUser(req),body=await readBody(req,1500),nickname=safeNickname(body.nickname);
    await remote('/rest/v1/bp_profiles?on_conflict=user_id',{method:'POST',data:{user_id:user.id,nickname,updated_at:new Date().toISOString()},bearer:token,prefer:'resolution=merge-duplicates,return=minimal'});
    return reply(res,200,{ok:true,nickname}),true;
   }
   if(path==='/api/account/backup'&&req.method==='GET'){
    const {user,token}=await validUser(req);
    const rows=await remote('/rest/v1/bp_saves?select=save%2Cupdated_at&user_id=eq.'+encodeURIComponent(user.id),{bearer:token});
    return reply(res,200,{ok:true,save:rows?.[0]?.save||null,updatedAt:rows?.[0]?.updated_at||null}),true;
   }
   if(path==='/api/account/backup'&&req.method==='POST'){
    const {user,token}=await validUser(req),body=await readBody(req,65000),save=body.save;
    if(!save||save.format!=='blockpop-full-backup-v1'||!save.session||!save.persistent||JSON.stringify(save).length>60000)return reply(res,400,{error:'セーブデータの形式が正しくないよ'}),true;
    await remote('/rest/v1/bp_saves?on_conflict=user_id',{method:'POST',bearer:token,data:{user_id:user.id,save,updated_at:new Date().toISOString()},prefer:'resolution=merge-duplicates,return=minimal'});
    return reply(res,200,{ok:true,updatedAt:new Date().toISOString()}),true;
   }
   return reply(res,404,{error:'アカウント機能が見つからないよ'}),true;
  }catch(e){
   const code=[400,401,403,404,409,413,422,429].includes(e.status)?e.status:502;
   return reply(res,code,{error:code===502?'アカウントサーバーの応答がありません。しばらくしてから試してね':String(e.message||'認証エラー').slice(0,150)}),true;
  }
 }
 return{enabled,handle};
};
