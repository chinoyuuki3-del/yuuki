import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {WebSocketServer,WebSocket} from 'ws';
import QRCode from 'qrcode';
import {newProfile,purchase,makePlayer,createMatch,tick,action,snapshot,clamp,WORLD} from './public/engine.mjs';

const root=fileURLToPath(new URL('./public/',import.meta.url));
const secret=process.env.GAME_SECRET||randomBytes(32).toString('hex');
const accounts=new Map(),rooms=new Map(),pending=new Map();
const code=()=>randomBytes(5).toString('hex').toUpperCase();
const cleanName=s=>String(s||'プレイヤー').replace(/[<>\u0000-\u001f]/g,'').trim().slice(0,16)||'プレイヤー';
const send=(s,o)=>{if(s?.readyState===WebSocket.OPEN&&s.bufferedAmount<200000)s.send(JSON.stringify(o));};
const error=(s,msg)=>send(s,{type:'error',message:msg});
function sign(profile){const payload=Buffer.from(JSON.stringify(profile)).toString('base64url');return payload+'.'+createHmac('sha256',secret).update(payload).digest('base64url');}
function verify(token){try{if(typeof token!=='string'||token.length>20000)return null;const [payload,sig]=token.split('.');const expected=createHmac('sha256',secret).update(payload).digest();const got=Buffer.from(sig||'','base64url');if(got.length!==expected.length||!timingSafeEqual(got,expected))return null;const p=JSON.parse(Buffer.from(payload,'base64url').toString());return p&&typeof p.id==='string'&&Array.isArray(p.friends)?p:null;}catch{return null;}}
function profile(a){send(a.socket,{type:'profile',profile:a.p,save:sign(a.p)});}
function roomInfo(room){return {code:room.code,practice:room.practice,control:room.control,origin:room.origin??null,players:[...room.members].map(id=>{const a=accounts.get(id);return {id,name:a.p.name,ready:a.ready,connected:!!a.socket};}),status:room.game?(room.paused?'paused':Date.now()<room.starts?'countdown':room.game.status):'waiting',remaining:Math.max(0,Math.ceil((room.starts-Date.now())/1000))};}
function announce(room){for(const id of room.members)send(accounts.get(id)?.socket,{type:'room',room:roomInfo(room)});}
function leave(a){if(!a.room)return;const r=rooms.get(a.room);a.room=null;a.ready=false;if(!r)return;r.members.delete(a.p.id);if(r.game||r.members.size===0){for(const id of r.members){const b=accounts.get(id);b.room=null;b.ready=false;send(b.socket,{type:'left',message:'相手が退出したため対戦を終了しました'});profile(b);}rooms.delete(r.code);}else announce(r);}
function start(room){const players=[...room.members].map((id,i)=>{const a=accounts.get(id);const position=room.control==='physical'?project(a.location||room.origin,room.origin):{x:i===0?-2:2,y:i===0?-7:7};const p=makePlayer(a.p,{...position,low:a.low,physical:room.control==='physical'});if(i===1)p.yaw=Math.PI;return p;});room.game=createMatch(players,{practice:room.practice,difficulty:room.difficulty});room.starts=Date.now()+3000;announce(room);}
function createRoom(a,m){if(rooms.size>=100)throw Error('ただいま満員です。少し待ってください');leave(a);let c;do{c=code().slice(0,8);}while(rooms.has(c));const control=m.control==='physical'?'physical':'keyboard';
  if(control==='physical'&&!validLocation(m.location))throw Error('精度20m以内の位置情報を取得してください');
  const r={code:c,members:new Set([a.p.id]),practice:m.practice!==false,control,origin:control==='physical'?m.location:null,difficulty:clamp(Number(m.difficulty)||0,0,3),game:null,starts:0,paused:false,created:Date.now()};
  rooms.set(c,r);a.room=c;a.location=control==='physical'?m.location:null;a.ready=r.practice;a.low=!!m.low;if(r.practice)start(r);else announce(r);
}
const validLocation=p=>p&&Number.isFinite(p.lat)&&Math.abs(p.lat)<=90&&Number.isFinite(p.lon)&&Math.abs(p.lon)<=180&&Number.isFinite(p.accuracy)&&p.accuracy>0&&p.accuracy<=20;
function project(p,o){return {x:(p.lon-o.lon)*111320*Math.cos(o.lat*Math.PI/180),y:(p.lat-o.lat)*111320};}
function route(a,m){const r=rooms.get(a.room),p=r?.game?.players.find(x=>x.id===a.p.id);
  switch(m.type){
  case 'name':a.p.name=cleanName(m.name);profile(a);break;
  case 'buy':if(r?.game&&r.game.status!=='ended')throw Error('ショップは対戦の前後に使えます');{const e=purchase(a.p,m.item);if(e)throw Error(e);profile(a);send(a.socket,{type:'notice',message:'購入しました！'});}break;
  case 'create':createRoom(a,m);break;
  case 'join':{const room=rooms.get(String(m.code||'').toUpperCase());if(!room||room.practice)throw Error('ルームが見つかりません');if(room.game||room.members.size>=2)throw Error('このルームは対戦中か満員です');if(room.control==='physical'){if(!validLocation(m.location))throw Error('位置情報を取得してから参加してください');const xy=project(m.location,room.origin);if(Math.hypot(xy.x,xy.y)>35)throw Error('相手から離れています。35m以内で参加してください');}leave(a);room.members.add(a.p.id);a.room=room.code;a.location=room.control==='physical'?m.location:null;a.ready=false;a.low=!!m.low;announce(room);break;}
  case 'ready':if(!r||r.game)return;a.ready=!a.ready;announce(r);if(r.members.size===2&&[...r.members].every(id=>accounts.get(id)?.ready))start(r);break;
  case 'leave':leave(a);send(a.socket,{type:'left'});profile(a);break;
  case 'pause':if(r?.practice&&r.game?.status==='playing'){r.paused=!!m.paused;announce(r);}break;
  case 'input':if(!p||r.paused||Date.now()<r.starts)return;p.lastInput=r.game.t;p.input={mx:clamp(Number(m.mx)||0,-1,1),my:clamp(Number(m.my)||0,-1,1),turn:clamp(Number(m.turn)||0,-1,1),tilt:clamp(Number(m.tilt)||0,-1,1),fire:!!m.fire};
    if(p.physical&&Number.isFinite(m.yaw)&&Number.isFinite(m.pitch)){p.yaw=m.yaw%(2*Math.PI);p.pitch=clamp(m.pitch,-1.35,1.35);}break;
  case 'location':if(p?.physical&&validLocation(m.location)&&r?.origin&&!r.paused){const xy=project(m.location,r.origin);if(Math.abs(xy.x)>1000||Math.abs(xy.y)>1000){send(a.socket,{type:'notice',message:'フィールドの外です。開始位置の近くに戻ってください'});return;}a.location=m.location;const now=Date.now(),dt=Math.min(2,(now-(p.lastGeo||now-1000))/1000),max=4*dt+1,dx=xy.x-p.x,dy=xy.y-p.y,len=Math.hypot(dx,dy);p.x+=dx*Math.min(1,max/(len||1));p.y+=dy*Math.min(1,max/(len||1));p.lastGeo=now;}break;
  case 'action':if(p&&!r.paused&&Date.now()>=r.starts)action(r.game,p,m.action,m.value);break;
  case 'friendRequest':{const id=String(m.code||'').trim().toUpperCase();const b=accounts.get(id);if(!b?.socket)throw Error('友達がゲームを開いているか確認してください');if(id===a.p.id)throw Error('自分のコードです');if(a.p.friends.some(f=>f.id===id))throw Error('すでに友達です');if(a.p.friends.length>=50||b.p.friends.length>=50)throw Error('友達は50人までです');pending.set(a.p.id+':'+id,{from:a.p.id,to:id,until:Date.now()+60000});send(b.socket,{type:'friendRequest',from:{id:a.p.id,name:a.p.name}});send(a.socket,{type:'notice',message:'友達申請を送りました。相手の確認を待っています'});break;}
  case 'friendAccept':{const key=String(m.from)+':'+a.p.id,q=pending.get(key),b=accounts.get(q?.from);if(!q||q.until<Date.now()||!b)throw Error('申請の期限が切れました');pending.delete(key);if(!a.p.friends.some(f=>f.id===b.p.id))a.p.friends.push({id:b.p.id,name:b.p.name});if(!b.p.friends.some(f=>f.id===a.p.id))b.p.friends.push({id:a.p.id,name:a.p.name});profile(a);profile(b);send(a.socket,{type:'notice',message:'友達に追加しました！'});send(b.socket,{type:'notice',message:a.p.name+'さんと友達になりました！'});break;}
  case 'ping':send(a.socket,{type:'pong',time:m.time});break;
  default:break;
  }
}
const contentTypes={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const http=createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
  res.setHeader('Permissions-Policy','geolocation=(self), accelerometer=(self), gyroscope=(self), magnetometer=(self), camera=(self)');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; media-src 'self' blob:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
  if(url.pathname==='/health'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true,version:'0.1.0',rooms:rooms.size}));return;}
  if(url.pathname==='/qr.svg'){const c=(url.searchParams.get('code')||'').toUpperCase();if(!/^[A-F0-9]{8,10}$/.test(c)){res.writeHead(400);res.end('Invalid code');return;}const key=url.searchParams.get('kind')==='friend'?'friend':'room';const protocol=req.headers['x-forwarded-proto']==='https'?'https':process.env.RENDER?'https':'http';const origin=process.env.PUBLIC_ORIGIN||protocol+'://'+req.headers.host;const svg=await QRCode.toString(origin+'/?'+key+'='+c,{type:'svg',margin:2,width:240,color:{dark:'#16252b',light:'#ffffff'}});res.setHeader('Content-Type','image/svg+xml');res.setHeader('Cache-Control','no-store');res.end(svg);return;}
  const path=url.pathname==='/'?'index.html':url.pathname.slice(1);
  if(!['index.html','app.mjs','engine.mjs','style.css','icon.svg','manifest.webmanifest'].includes(path)){res.writeHead(404);res.end('Not found');return;}
  const data=await readFile(root+path);res.setHeader('Content-Type',contentTypes['.'+path.split('.').pop()]||'text/plain');res.setHeader('Cache-Control','no-cache');res.end(data);
}catch{res.writeHead(500);res.end('Server error');}});
const wss=new WebSocketServer({noServer:true,maxPayload:24000,perMessageDeflate:false});
http.on('upgrade',(req,socket,head)=>{let origin;try{origin=new URL(req.headers.origin);}catch{socket.destroy();return;}if(req.url!=='/ws'||origin.host!==req.headers.host){socket.destroy();return;}if(wss.clients.size>=250){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>wss.emit('connection',ws,req));});
wss.on('connection',ws=>{let account=null,count=0,windowStart=Date.now();ws.alive=true;const authTimeout=setTimeout(()=>{if(!account)ws.close(4001,'Handshake required');},10000);ws.on('pong',()=>ws.alive=true);
  ws.on('message',raw=>{try{if(Date.now()-windowStart>1000){count=0;windowStart=Date.now();}if(++count>65){ws.close(4008,'Too many messages');return;}const m=JSON.parse(raw.toString());if(!m||typeof m.type!=='string')return;
    if(!account){if(m.type!=='hello')return;const recovered=verify(m.save);let reset=!!m.save&&!recovered;const saved=recovered||newProfile(code(),cleanName(m.name));account=accounts.get(saved.id);if(!account){if(accounts.size>=2000)throw Error('ただいま満員です');account={p:saved,socket:null,room:null,ready:false,low:false,last:Date.now()};accounts.set(saved.id,account);}if(account.socket&&account.socket!==ws)account.socket.close(4002,'別の画面でログインしました');account.socket=ws;clearTimeout(authTimeout);profile(account);send(ws,{type:'session',room:account.room});if(reset)send(ws,{type:'notice',message:'保存情報を復元できなかったため、新しくスタートしました'});if(account.room){const r=rooms.get(account.room);if(r)announce(r);}return;}
    account.last=Date.now();route(account,m);
  }catch(e){error(ws,e.message==='Unexpected end of JSON input'?'通信を確認してください':String(e.message||'操作できませんでした').slice(0,120));}});
  ws.on('close',()=>{clearTimeout(authTimeout);if(account?.socket===ws){account.socket=null;account.last=Date.now();const r=rooms.get(account.room);if(r){r.paused=true;r.disconnected=Date.now();announce(r);}}});ws.on('error',()=>{});
});
let step=0;
const loop=setInterval(()=>{step++;for(const room of rooms.values()){
  if(!room.game){if(Date.now()-room.created>30*60*1000){for(const id of room.members){const a=accounts.get(id);leave(a);send(a.socket,{type:'left',message:'ルームの待機期限が切れました'});}}continue;}
  const disconnected=[...room.members].some(id=>!accounts.get(id)?.socket);
  if(disconnected){room.paused=true;if(Date.now()-(room.disconnected||Date.now())>60000){for(const id of [...room.members]){const a=accounts.get(id);leave(a);send(a?.socket,{type:'left',message:'通信が戻らなかったため終了しました'});}}continue;}
  if(room.disconnected){room.disconnected=null;room.paused=false;announce(room);}
  if(Date.now()>=room.starts&&!room.paused)tick(room.game,.05);
  for(const id of room.members){const a=accounts.get(id);if(step%(a.low?4:2)===0)send(a.socket,{type:'state',state:snapshot(room.game,id),room:roomInfo(room)});if(step%20===0)profile(a);}
}},50);
const maintenance=setInterval(()=>{for(const ws of wss.clients){if(!ws.alive){ws.terminate();continue;}ws.alive=false;ws.ping();}for(const [k,v] of pending)if(v.until<Date.now())pending.delete(k);for(const [k,a] of accounts)if(!a.socket&&!a.room&&Date.now()-a.last>3600000)accounts.delete(k);},30000);
const port=Number(process.env.PORT)||3000;
http.listen(port,'0.0.0.0',()=>console.log('FIELDLINK listening on port '+port));
function close(){clearInterval(loop);clearInterval(maintenance);for(const a of accounts.values()){profile(a);a.socket?.close(1012,'Server restarting');}http.close(()=>process.exit(0));setTimeout(()=>process.exit(0),3000).unref();}
process.on('SIGTERM',close);process.on('SIGINT',close);
