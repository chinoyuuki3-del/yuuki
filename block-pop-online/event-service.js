'use strict';
/* Block Pop! ONLINE event API. Persists all state in Supabase Postgres via a
 * private, server-key protected RPC. The RPC key NEVER reaches the browser.
 */
const crypto=require('node:crypto');
module.exports=function createEventService({isAdmin=()=>false,origin=process.env.BLOCKPOP_SUPABASE_URL||'',anonKey=process.env.BLOCKPOP_SUPABASE_ANON_KEY||'',serverKey=process.env.BLOCKPOP_EVENTS_SERVER_KEY||'',fetcher=fetch}={}){
 const enabled=/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(origin)&&anonKey.length>20&&serverKey.length>=48;
 const endpoint=origin.replace(/\/$/,'')+'/rest/v1/rpc/bp_event_api';
 const limited=new Map();
 function json(res,code,payload){const data=Buffer.from(JSON.stringify(payload));res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Content-Length':data.length,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(data);}
 function cors(req,res){
  const origin=req.headers.origin,host=String(req.headers.host||'');
  const safe=!origin||origin==='null'||origin==='https://block-pop-online.onrender.com'||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)||(()=>{try{const url=new URL(origin);return url.protocol==='https:'&&url.host===host;}catch{return false}})();
  if(!safe)return false;
  res.setHeader('Access-Control-Allow-Origin',origin||'*');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');res.setHeader('Vary','Origin');return true;
 }
 function ratelimit(req,action,max=24,window=60000){
  const ip=String(req.headers['x-forwarded-for']||req.socket?.remoteAddress||'unknown').split(',')[0].trim().slice(0,70);
  const hash=crypto.createHash('sha256').update(ip+'|'+action).digest('hex').slice(0,20);
  const now=Date.now();let entry=limited.get(hash);
  if(!entry||entry.until<now){entry={until:now+window,count:0};limited.set(hash,entry);}
  if(limited.size>4000)for(const [k,v] of limited)if(v.until<now)limited.delete(k);
  return ++entry.count<=max;
 }
 async function read(req,max=3500){
  if(!/^application\/json(?:\s*;|$)/i.test(String(req.headers['content-type']||'')))throw Object.assign(Error('JSON形式で送ってね'),{status:415});
  let size=0,text='';for await(const chunk of req){size+=chunk.length;if(size>max)throw Object.assign(Error('送信内容が大きすぎるよ'),{status:413});text+=chunk.toString('utf8');}
  let data;try{data=JSON.parse(text)}catch{throw Object.assign(Error('JSON形式を確認してね'),{status:400})}
  if(!data||Array.isArray(data)||typeof data!=='object')throw Object.assign(Error('入力が正しくないよ'),{status:400});return data;
 }
 async function rpc(action,payload={}){
  if(!enabled)throw Object.assign(Error('イベント用データベースを準備中だよ'),{status:503});
  const abort=new AbortController(),timeout=setTimeout(()=>abort.abort(),12000);
  try{
   const res=await fetcher(endpoint,{method:'POST',signal:abort.signal,
    headers:{'apikey':anonKey,'Authorization':'Bearer '+anonKey,'Content-Type':'application/json'},
    body:JSON.stringify({p_action:action,p_payload:payload,p_key:serverKey})});
   const raw=await res.text();let data;try{data=JSON.parse(raw)}catch{data=null}
   if(!res.ok){const detail=String(data?.message||'イベントサーバー処理エラー').slice(0,120);throw Object.assign(Error(res.status>=500?'イベント保存サーバーの応答に問題があるよ':detail),{status:res.status>=500?503:400});}
   return data;
  }finally{clearTimeout(timeout)}
 }
 function player(data){if(typeof data.playerId!=='string'||!/^[a-f0-9]{32}$/.test(data.playerId))throw Object.assign(Error('プレイヤーIDが正しくないよ'),{status:400});return data.playerId}
 function eventId(data){if(typeof data.id!=='string'||!/^[a-f0-9-]{36}$/.test(data.id))throw Object.assign(Error('イベントIDが正しくないよ'),{status:400});return data.id}
 async function handle(req,res,path){
  if(!path.startsWith('/api/events'))return false;
  if(!cors(req,res)){json(res,403,{error:'許可されていない接続元です'});return true}
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return true}
  const admin=path.startsWith('/api/events/admin');
  if(admin&&!isAdmin(req)){json(res,401,{error:'管理者センターでログインしてね'});return true}
  if(!enabled){json(res,503,{error:'イベントデータベースが未設定です'});return true}
  try{
   if(path==='/api/events'&&req.method==='GET')return json(res,200,await rpc('list',{})),true;
   if(path==='/api/events/admin'&&req.method==='GET')return json(res,200,await rpc('admin_list',{})),true;
   if(!ratelimit(req,admin?'admin':path,admin?16:36)){json(res,429,{error:'操作が多すぎます。少し待ってね'});return true}
   if(req.method!=='POST'){json(res,405,{error:'POSTで送信してね'});return true}
   const b=await read(req,admin?7500:1600);
   if(path==='/api/events/admin'){
    const action=b.action;
    if(!['create','edit','cancel'].includes(action)){json(res,400,{error:'不明な操作です'});return true}
    if(action!=='create')eventId(b);
    if(action==='create'||action==='edit'){
     const title=String(b.title||'').trim(),type=b.type,startsAt=String(b.startsAt||''),endsAt=String(b.endsAt||'');
     if(title.length<2||title.length>48||/[<>\r\n\u0000-\u001f]/.test(title)||!['coins','tournament','gift'].includes(type)||
       !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(startsAt)||
       !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(endsAt)||
       !(Date.parse(startsAt)<Date.parse(endsAt))||!(Date.parse(endsAt)-Date.parse(startsAt)<=90*86400000)||
       ![1,1.5,2,3].includes(Number(b.multiplier))||!Number.isInteger(b.rewardCoins)||b.rewardCoins<0||b.rewardCoins>1000){
      json(res,400,{error:'イベント名・種類・日時・倍率・報酬を確認してね（開催は90日以内）'});return true;
     }
    }
    const payload={action,...b};return json(res,200,await rpc('admin_write',payload)),true;
   }
   if(path==='/api/events/join'||path==='/api/events/claim'){
    const p={id:eventId(b),playerId:player(b),nickname:String(b.nickname||'ゲスト').trim().slice(0,16)};
    return json(res,200,await rpc(path.endsWith('join')?'join':'claim',p)),true;
   }
   json(res,404,{error:'イベント機能が見つからないよ'});return true;
  }catch(err){const status=[400,401,403,405,413,415,429,503].includes(err.status)?err.status:503;
   json(res,status,{error:status===503?'イベントサーバーに接続できないよ。時間をおいて再試行してね':String(err.message).slice(0,110)});return true;
  }
 }
 async function recordMatch({code,players,reason}){
  if(!enabled||!Array.isArray(players)||players.length!==2)return;
  const valid=players.filter(p=>p&&/^[a-f0-9]{32}$/.test(p.playerId||'')&&Number.isInteger(p.score)&&p.score>=0);
  if(valid.length!==2)return;
  try{return await rpc('record_match',{code:String(code),reason:String(reason||''),players:valid.map(p=>({playerId:p.playerId,nickname:p.name,score:p.score}))});}
  catch(e){console.warn('Event match recording failed:',e.message);}
 }
 return{enabled,handle,recordMatch,rpc};
};
