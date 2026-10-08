'use strict';
/** Block Pop! username/password account API (no email address or email confirmation).
 * Accounts, bcrypt password hashes and cloud saves stay in Supabase private tables.
 * Only the Render server exposes this proxy. Public RPC checks random session tokens.
 */
const crypto=require('node:crypto');
const PREFIX='/api/account/';
module.exports=function createAccountService({url=process.env.BLOCKPOP_SUPABASE_URL||'',key=process.env.BLOCKPOP_SUPABASE_ANON_KEY||''}={}){
 const enabled=/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(url)&&key.length>20;
 const base=url.replace(/\/$/,'');
 const rate=new Map();
 function ipKey(req){
  const ip=String(req.headers['x-forwarded-for']||'').split(',')[0].trim()||req.socket.remoteAddress||'unknown';
  return crypto.createHash('sha256').update(ip).digest('hex').slice(0,24);
 }
 function limited(req,route,max,period){
  const now=Date.now(),k=ipKey(req)+':'+route,old=rate.get(k);
  if(rate.size>9000)for(const [id,row] of rate){if(now-row.since>3600000)rate.delete(id);}
  if(!old||now-old.since>period){rate.set(k,{count:1,since:now});return false;}
  old.count++;return old.count>max;
 }
 function reply(res,code,obj){
  const body=JSON.stringify(obj);res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Content-Length':Buffer.byteLength(body)});res.end(body);
 }
 function cors(req,res){
  const origin=req.headers.origin,host=String(req.headers.host||'');
  let permitted=!origin||origin==='null'||origin==='https://block-pop-online.onrender.com'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  if(!permitted){try{const u=new URL(origin);permitted=u.protocol==='https:'&&u.host===host;}catch{}}
  if(!permitted){reply(res,403,{error:'許可されていない接続元だよ'});return false;}
  if(origin)res.setHeader('Access-Control-Allow-Origin',origin);
  res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
  res.setHeader('Vary','Origin');return true;
 }
 async function readJson(req,maxBytes=3000){
  let total=0,parts=[];
  for await(const part of req){total+=part.length;if(total>maxBytes)throw Object.assign(Error('データが大きすぎるよ'),{status:413});parts.push(part);}
  try{const data=JSON.parse(Buffer.concat(parts).toString('utf8'));if(!data||Array.isArray(data)||typeof data!=='object')throw Error();return data;}
  catch{throw Object.assign(Error('リクエストの形式が正しくないよ'),{status:400});}
 }
 async function rpc(action,payload){
  const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),22000);
  try{
   const res=await fetch(base+'/rest/v1/rpc/bp_username_api',{
    method:'POST',signal:abort.signal,
    headers:{'Content-Type':'application/json','apikey':key,'Authorization':'Bearer '+key,'Accept':'application/json'},
    body:JSON.stringify({p_action:action,p_payload:payload})
   });
   let data;try{data=await res.json();}catch{data=null;}
   if(!res.ok){
    const msg=String(data?.message||data?.error||'アカウント保存先でエラーが発生したよ').slice(0,150);
    // A missing migration means authentication can never work, so show a clear error.
    if(res.status===404||data?.code==='PGRST202')throw Object.assign(Error('アカウント用データベースの準備が必要だよ'),{status:503});
    throw Object.assign(Error(msg),{status:res.status>=500?502:400});
   }
   if(!data||typeof data!=='object'||Array.isArray(data))throw Object.assign(Error('サーバーから正しい応答を受信できないよ'),{status:502});
   if(data.ok===false||data.error)throw Object.assign(Error(String(data.error||'認証に失敗したよ').slice(0,150)),{status:action==='login'?401:400});
   return data;
  }finally{clearTimeout(timer);}
 }
 function getToken(req){
  const token=/^Bearer\s+([a-f0-9]{64})$/i.exec(String(req.headers.authorization||''));
  if(!token)throw Object.assign(Error('ログインしてから使ってね'),{status:401});
  return token[1].toLowerCase();
 }
 function username(value){
  const n=String(value||'').trim().normalize('NFKC').toLowerCase();
  if(!/^[\p{L}\p{N}_]{2,20}$/u.test(n))throw Object.assign(Error('ユーザー名は2～20文字。文字・数字・_が使えるよ'),{status:400});
  return n;
 }
 function password(value){
  const p=String(value||'');
  if(p.length<8||p.length>128)throw Object.assign(Error('パスワードは8～128文字にしてね'),{status:400});
  return p;
 }
 function nickname(value,otherwise){
  const name=String(value||otherwise||'').trim().normalize('NFKC').slice(0,20);
  if(!name||/[<>\r\n\u0000-\u001f]/.test(name))throw Object.assign(Error('表示名は1～20文字で入力してね'),{status:400});
  return name;
 }
 async function handle(req,res,path){
  if(!path.startsWith(PREFIX))return false;
  if(!cors(req,res))return true;
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return true;}
  if(path==='/api/account/status'){reply(res,200,{enabled,provider:'username',usernameLogin:true,requiresEmail:false,cloudSave:enabled});return true;}
  if(!enabled){reply(res,503,{error:'アカウントの保存先を準備中だよ。ゲスト対戦は使えるよ'});return true;}
  try{
   if(path==='/api/account/register'&&req.method==='POST'){
    if(limited(req,'register',6,3600000))throw Object.assign(Error('登録が多すぎるよ。しばらくしてから試してね'),{status:429});
    const b=await readJson(req,4000),n=username(b.username),pw=password(b.password);
    const data=await rpc('register',{username:n,password:pw,nickname:nickname(b.nickname,n)});
    reply(res,200,{ok:true,session:data.session,message:'ユーザー名で登録できたよ！ 確認メールは不要だよ'});return true;
   }
   if(path==='/api/account/login'&&req.method==='POST'){
    if(limited(req,'login',32,600000))throw Object.assign(Error('入力回数が多いよ。10分後に試してね'),{status:429});
    const b=await readJson(req,4000);
    const data=await rpc('login',{username:username(b.username),password:password(b.password)});
    reply(res,200,{ok:true,session:data.session});return true;
   }
   if(path==='/api/account/refresh'&&req.method==='POST'){
    if(limited(req,'refresh',80,600000))throw Object.assign(Error('更新回数が多すぎるよ'),{status:429});
    const body=await readJson(req),ref=String(body.refreshToken||'');
    if(!/^[a-f0-9]{64}$/i.test(ref))throw Object.assign(Error('もう一度ログインしてね'),{status:401});
    const data=await rpc('refresh',{refreshToken:ref.toLowerCase()});
    reply(res,200,{ok:true,session:data.session});return true;
   }
   if(path==='/api/account/me'&&req.method==='GET'){
    const data=await rpc('me',{token:getToken(req)});
    reply(res,200,data);return true;
   }
   if(path==='/api/account/nickname'&&req.method==='POST'){
    const token=getToken(req),b=await readJson(req);
    const data=await rpc('nickname',{token,nickname:nickname(b.nickname)});reply(res,200,data);return true;
   }
   if(path==='/api/account/backup'&&req.method==='GET'){
    const data=await rpc('backup_get',{token:getToken(req)});reply(res,200,data);return true;
   }
   if(path==='/api/account/backup'&&req.method==='POST'){
    const token=getToken(req),body=await readJson(req,65000),save=body.save;
    if(!save||save.format!=='blockpop-full-backup-v1'||!save.session||!save.persistent||JSON.stringify(save).length>60000)
     throw Object.assign(Error('セーブデータの形式が正しくないよ'),{status:400});
    const data=await rpc('backup_put',{token,save});reply(res,200,data);return true;
   }
   if(path==='/api/account/logout'&&req.method==='POST'){
    const data=await rpc('logout',{token:getToken(req)});reply(res,200,data);return true;
   }
   reply(res,404,{error:'アカウント機能が見つからないよ'});return true;
  }catch(e){
   const code=[400,401,403,404,409,413,422,429,503].includes(e.status)?e.status:502;
   let message=code===502?'アカウント用サーバーが応答しないよ。少ししてから試してね':String(e.message||'認証エラー').slice(0,150);
   if(code===400&&/ログイン|セッション|期限/.test(message)){
    reply(res,401,{error:message});return true;
   }
   reply(res,code,{error:message});return true;
  }
 }
 return{enabled,handle};
};