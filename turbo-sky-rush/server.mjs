/** TURBO SKY RUSH - dependency-free single-instance Render server. */
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const BASE = path.dirname(fileURLToPath(import.meta.url));
const rooms = new Map();
const players = new Map();
const records = [];
// One highest speed per browser/vehicle. Memory-only until a persistent DB is configured.
const speedRecords = new Map();
let recordId = 0;
let speedRecordId = 0;
const now = () => Date.now();
const DEFAULTS = [
 ['arena-1', 'サーキット ALPHA'],
 ['arena-2', 'サーキット BRAVO'],
 ['arena-3', 'サーキット CHARLIE'],
];
for (const [code, name] of DEFAULTS) rooms.set(code, { code,name,official:true,raceNo:0,raceStartAt:0,laps:3,createdAt:now() });
const roomCodeOK = s => /^[a-z0-9-]{3,32}$/.test(s);
const playerIdOK = s => /^[a-zA-Z0-9_-]{8,96}$/.test(s);
const clean = (v, max, fallback='Player') => String(v??'').trim().slice(0,max) || fallback;
const numeric = (v, fallback=0, limit=1e6) => { const n=Number(v); return Number.isFinite(n)?Math.max(-limit,Math.min(limit,n)):fallback; };
const retire = () => {
 const t=now();
 for(const [id,p] of players) if (p.updatedAt<t-10000) players.delete(id);
 const occupied = new Set(Array.from(players.values(),p=>p.roomCode));
 for(const [code,r] of rooms) if (!r.official && r.createdAt<t-2*60*60*1000 && !occupied.has(code)) rooms.delete(code);
};
function activeRooms(){
 retire(); const t=now();
 return [...rooms.values()].sort((a,b)=>Number(b.official)-Number(a.official)||b.createdAt-a.createdAt).slice(0,30).map(r=>({
 code:r.code,name:r.name,official:r.official,raceNo:r.raceNo,
 players:[...players.values()].filter(p=>p.roomCode===r.code&&p.updatedAt>t-6000).length,
 }));
}
function reply(res,status,data){
 res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff', 'access-control-allow-origin':'*'});
 res.end(JSON.stringify(data));
}
async function parseJson(req){
 const pieces=[]; let total=0;
 for await(const part of req){ total+=part.length; if(total>8192) throw new Error('too_large'); pieces.push(part); }
 const txt=Buffer.concat(pieces).toString('utf8');
 return txt ? JSON.parse(txt):{};
}
function top(kind){return records.filter(r=>r.kind===kind).sort((a,b)=>a.timeMs-b.timeMs).slice(0,10);}
function speedTop(kind) {
 return [...speedRecords.values()].filter(r=>r.kind===kind)
  .sort((a,b)=>b.speedKmh-a.speedKmh || a.createdAt-b.createdAt)
  .slice(0,10)
  .map(({id,name,vehicleId,kind,speedKmh,createdAt})=>({id,name,vehicleId,kind,speedKmh,createdAt}));
}
const vehicleSpeedLimitKmh = new Map(Object.entries({
 starhatch:190,minicute:160,blazecoupe:240,turbosedan:250,roadking:270,
 thundergt:290,phantomr:320,neondrifter:270,mountainsuv:210,junglebuggy:200,
 toughtruck:200,deliveryvan:170,formulazero:360,solarev:260,venomgtr:340,
 retrobug:150,interceptor:280,rallymonster:230,goldemperor:260,hyperrocket:380,
 skyhawk:288,aeroracer:396,stormfighter:684,phantomv:864,
}));
async function api(req,res,pathname){
 const method=req.method;
 if(pathname==='/api/health'&&method==='GET')return reply(res,200,{ok:true,service:'turbo-sky-rush',storage:'memory',players:players.size});
 if(pathname==='/api/rooms'&&method==='GET')return reply(res,200,{rooms:activeRooms(),storage:'memory'});
 if(pathname==='/api/rooms'&&method==='POST'){
  const b=await parseJson(req),code=randomBytes(5).toString('hex'),name=clean(b.name,24,'ニュールーム');
  retire();
  if(rooms.size>=103)return reply(res,429,{error:'room_limit_reached'});
  rooms.set(code,{code,name,official:false,raceNo:0,raceStartAt:0,laps:3,createdAt:now()});
  return reply(res,201,{code,name,storage:'memory'});
 }
 // Let the lobby verify invitation links before entering a 3D session.
 const lookup=/^\/api\/rooms\/([a-z0-9-]{3,32})$/.exec(pathname);
 if(lookup&&method==='GET'){
  retire();
  const room=rooms.get(lookup[1]);
  if(!room)return reply(res,404,{error:'room_not_found'});
  const t=now();
  return reply(res,200,{room:{code:room.code,name:room.name,raceNo:room.raceNo,players:[...players.values()].filter(p=>p.roomCode===room.code&&p.updatedAt>t-6000).length}});
 }
 if(pathname==='/api/speed-records'&&method==='GET')
  return reply(res,200,{car:speedTop('car'),plane:speedTop('plane'),storage:'memory'});
 if(pathname==='/api/speed-records'&&method==='POST'){
  const b=await parseJson(req), speedKmh=Math.round(Number(b.speedKmh));
  const vehicleId=String(b.vehicleId??''), playerId=String(b.playerId??'');
  const vmax=vehicleSpeedLimitKmh.get(vehicleId);
  if (!playerIdOK(playerId)||!vmax||!Number.isFinite(speedKmh)||speedKmh<30||speedKmh>Math.ceil(vmax*1.65))
   return reply(res,400,{error:'invalid_speed_record'});
  const key=`${playerId}:${vehicleId}`, previous=speedRecords.get(key), t=now();
  if(previous && speedKmh<=previous.speedKmh)return reply(res,200,{ok:true,updated:false});
  if(previous && t-previous.updatedAt<8000)return reply(res,429,{error:'too_many_updates'});
  if(!previous && speedRecords.size>=2000) {
   const oldest=[...speedRecords].sort((a,b)=>a[1].updatedAt-b[1].updatedAt)[0];
   if(oldest) speedRecords.delete(oldest[0]);
  }
  const item={id:previous?.id??++speedRecordId,name:clean(b.name,16),vehicleId,
   kind:vehicleKinds.get(vehicleId),speedKmh,createdAt:previous?.createdAt??t,updatedAt:t};
  speedRecords.set(key,item);
  return reply(res,201,{ok:true,updated:true,rank:speedTop(item.kind).findIndex(r=>r.id===item.id)+1});
 }
 if(pathname==='/api/records'&&method==='GET')return reply(res,200,{car:top('car'),plane:top('plane')});
 if(pathname==='/api/records'&&method==='POST'){
   const b=await parseJson(req),timeMs=Math.round(Number(b.timeMs)),kind=b.kind;
   if(!Number.isFinite(timeMs)||timeMs<8000||timeMs>3600000||!vehicleIDs.has(b.vehicleId))return reply(res,400,{error:'invalid'});
   records.push({id:++recordId,name:clean(b.name,16),vehicleId:b.vehicleId,kind:kind==='plane'?'plane': vehicleKinds.get(b.vehicleId) ??'car',laps:3,timeMs,createdAt:now()});
   if(records.length>1000)records.splice(0,records.length-1000);
   return reply(res,201,{ok:true});
 }
 const match=/^\/api\/rooms\/([^/]+)\/(start|sync|leave)$/.exec(pathname);
 if(match&&method==='POST'){
  const [,code,action]=match;
  if(!roomCodeOK(code))return reply(res,400,{error:'invalid_room'});
  const room=rooms.get(code);
  if(action==='start'){
   if(!room)return reply(res,404,{error:'room_not_found'});
   const t=now();
   if(!room.raceStartAt||t-room.raceStartAt>=12000){room.raceNo++;room.raceStartAt=t+7000;}
   return reply(res,200,{raceNo:room.raceNo,raceStartAt:room.raceStartAt});
  }
  const b=await parseJson(req),id=clean(b.id,96,'');
  if(action==='leave'){
   if(playerIdOK(id)&&players.get(id)?.roomCode===code)players.delete(id);
   return reply(res,200,{ok:true});
  }
  if(!playerIdOK(id))return reply(res,400,{error:'invalid_id'});
  if(!room)return reply(res,404,{error:'room_not_found'});
  const vehicleId=String(b.vehicleId??'starhatch');
  if(!vehicleIDs.has(vehicleId))return reply(res,400,{error:'invalid_vehicle'});
  retire();const t=now();
  const p={id,roomCode:code,name:clean(b.name,16),vehicleId,color:Math.round(numeric(b.color,-1,0xffffff)),
   x:numeric(b.x),y:numeric(b.y),z:numeric(b.z),vx:numeric(b.vx,0,1000),vy:numeric(b.vy,0,1000),vz:numeric(b.vz,0,1000),
   yaw:numeric(b.yaw,0,100),pitch:numeric(b.pitch,0,100),roll:numeric(b.roll,0,100),speed:numeric(b.speed,0,1000),
   cp:Math.round(Math.max(0,numeric(b.cp,0,10000))),finishMs:Math.round(numeric(b.finishMs,-1,1e9)),
   raceNo:Math.round(Math.max(0,numeric(b.raceNo,0,1e9))),updatedAt:t};
  if(!players.has(id)&&[...players.values()].filter(other=>other.roomCode===code).length>=32)return reply(res,429,{error:'room_full'});
  players.set(id,p);
  const others=[...players.values()].filter(other=>other.roomCode===code&&other.id!==id&&other.updatedAt>t-6000)
   .map(({id,name,vehicleId,color,x,y,z,vx,vy,vz,yaw,pitch,roll,speed,cp,finishMs,raceNo})=>({id,name,vehicleId,color,x,y,z,vx,vy,vz,yaw,pitch,roll,speed,cp,finishMs,raceNo}));
  return reply(res,200,{now:t,storage:'memory',room:{code:room.code,name:room.name,raceNo:room.raceNo,raceStartAt:room.raceStartAt,laps:room.laps},players:others});
 }
 return reply(res,404,{error:'not_found'});
}
// VEHICLE_IDS generated from original src/lib/vehicles.ts by build step; fallback list is kept in sync below.
const vehicleIDs = new Set(["starhatch", "minicute", "blazecoupe", "turbosedan", "roadking", "thundergt", "phantomr", "neondrifter", "mountainsuv", "junglebuggy", "toughtruck", "deliveryvan", "formulazero", "solarev", "venomgtr", "retrobug", "interceptor", "rallymonster", "goldemperor", "hyperrocket", "skyhawk", "aeroracer", "stormfighter", "phantomv"]);
const vehicleKinds = new Map([["starhatch", "car"], ["minicute", "car"], ["blazecoupe", "car"], ["turbosedan", "car"], ["roadking", "car"], ["thundergt", "car"], ["phantomr", "car"], ["neondrifter", "car"], ["mountainsuv", "car"], ["junglebuggy", "car"], ["toughtruck", "car"], ["deliveryvan", "car"], ["formulazero", "car"], ["solarev", "car"], ["venomgtr", "car"], ["retrobug", "car"], ["interceptor", "car"], ["rallymonster", "car"], ["goldemperor", "car"], ["hyperrocket", "car"], ["skyhawk", "plane"], ["aeroracer", "plane"], ["stormfighter", "plane"], ["phantomv", "plane"]]);
const PORT = Number(process.env.PORT||10000);
const server=http.createServer(async (req,res)=>{
 try{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`),pathname=url.pathname;
  if(pathname.startsWith('/api/')&&req.method==='OPTIONS'){res.writeHead(204,{'access-control-allow-origin':'*','access-control-allow-headers':'content-type','access-control-allow-methods':'GET,POST,OPTIONS','access-control-max-age':'86400'});res.end();return;}
  if(pathname.startsWith('/api/'))return await api(req,res,pathname);
  if(req.method!=='GET'&&req.method!=='HEAD')return reply(res,405,{error:'method_not_allowed'});
  if(pathname!=='/'&&pathname!=='/index.html')return reply(res,404,{error:'not_found'});
  const html=await readFile(path.join(BASE,'public','index.html'));
  res.writeHead(200,{'content-type':'text/html; charset=utf-8','cache-control':'no-cache','x-content-type-options':'nosniff'});
  res.end(req.method==='HEAD'?undefined:html);
 }catch(e){console.error('Server error',e);reply(res,e?.message==='too_large'?413:400,{error:'request_failed'});}
});
server.listen(PORT,'0.0.0.0',()=>console.log(`TURBO SKY RUSH listening on ${PORT}`));