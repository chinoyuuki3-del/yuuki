'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib');
const PORT=Number(process.env.PORT||3000),VERSION='1.2.4',ROUND_MS=120000;
// Serve the game as one compressed, cached HTML resource (no external assets).
const PAGE=fs.readFileSync(path.join(__dirname,'index.html'));
if(PAGE.length>5*1024*1024)throw Error('Game HTML must stay under 5 MiB');
const PAGE_GZIP=zlib.gzipSync(PAGE,{level:9});
const PAGE_ETAG='W/"'+crypto.createHash('sha256').update(PAGE).digest('hex')+'"';
// The shop catalog is a separate, deployable resource. Edits do not require a client update.
const SHOP_JSON=fs.readFileSync(path.join(__dirname,'shop-catalog.json'));
if(SHOP_JSON.length>30000)throw Error('Shop catalog exceeds 30 KB');
const SHOP_DATA=JSON.parse(SHOP_JSON.toString('utf8'));
if(!Array.isArray(SHOP_DATA.items)||SHOP_DATA.items.length!==62)throw Error('Invalid shop catalog');
const SHOP_GZIP=zlib.gzipSync(SHOP_JSON,{level:9});
const SHOP_ETAG='W/"'+crypto.createHash('sha256').update(SHOP_JSON).digest('hex')+'"';
const rooms=new Map(),ABC='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const stamp=()=>Date.now();
function code(){let s;do{s=Array.from({length:6},()=>ABC[crypto.randomInt(ABC.length)]).join('')}while(rooms.has(s));return s;}
function send(c,obj){if(c&&!c.closed&&c.socket.writable)c.send(JSON.stringify(obj));}
function broadcast(room,type,data={}){for(const p of room.players)send(p,{type,...data});}
function state(room){return{code:room.code,status:room.status,players:room.players.map(p=>({slot:p.slot,score:p.score,connected:true})),endsAt:room.endsAt};}
function error(c,message){send(c,{type:'error',message});}
function finish(room,cause='time'){
  if(!room||room.status!=='playing')return;
  room.status='finished';clearTimeout(room.timer);
  const scores=room.players.map(p=>p.score);
  const winner=room.players.length===2&&scores[0]!==scores[1]?
    (scores[0]>scores[1]?room.players[0].slot:room.players[1].slot):null;
  broadcast(room,'result',{cause,winner,scores});
  setTimeout(()=>{if(rooms.get(room.code)===room)rooms.delete(room.code)},300000).unref();
}
function leave(c,closing=false){
  const room=c.room;if(!room)return;c.room=null;
  room.players=room.players.filter(p=>p!==c);
  if(room.status==='playing'){
    room.status='finished';clearTimeout(room.timer);
    broadcast(room,'result',{cause:'disconnect',winner:room.players[0]?.slot??null,scores:room.players.map(p=>p.score)});
  }else if(room.status==='lobby'){
    if(room.players[0])room.players[0].slot=0;
    broadcast(room,'room',state(room));
  }
  if(room.status==='finished'||room.players.length===0)rooms.delete(room.code);
  if(!closing)send(c,{type:'left'});
}
function receive(c,m){
  const t=stamp();if(t-c.rateStart>=1000){c.rateStart=t;c.rate=0;}
  if(++c.rate>25){error(c,'送信が多すぎます');return;}
  if(!m||typeof m!=='object'||typeof m.type!=='string')return;
  if(m.type==='create'){
    if(c.room)leave(c);const room={code:code(),players:[c],status:'lobby',createdAt:t,endsAt:0,timer:null};
    rooms.set(room.code,room);c.room=room;c.slot=0;c.score=0;
    send(c,{type:'joined',slot:0,code:room.code});broadcast(room,'room',state(room));
  }else if(m.type==='join'){
    if(typeof m.code!=='string'||!/^[A-HJ-NP-Z2-9]{6}$/.test(m.code.toUpperCase()))return error(c,'6文字のコードを入力してね');
    const room=rooms.get(m.code.toUpperCase());
    if(!room||room.status!=='lobby'||room.players.length!==1)return error(c,'ルームが見つからないか満員だよ');
    if(c.room)leave(c);c.room=room;c.slot=1;c.score=0;room.players.push(c);
    send(c,{type:'joined',slot:1,code:room.code});broadcast(room,'room',state(room));
  }else if(m.type==='start'){
    const room=c.room;
    if(!room||c.slot!==0||room.status!=='lobby'||room.players.length!==2)return error(c,'2人そろったらホストが開始できるよ');
    room.status='playing';room.seed=crypto.randomInt(1,2147483647);room.endsAt=stamp()+ROUND_MS;
    for(const p of room.players)p.score=0;
    broadcast(room,'start',{seed:room.seed,endsAt:room.endsAt,roundMs:ROUND_MS});
    room.timer=setTimeout(()=>finish(room),ROUND_MS+100);room.timer.unref();
  }else if(m.type==='score'){
    const room=c.room;if(!room||room.status!=='playing'||stamp()>=room.endsAt)return;
    if(!Number.isInteger(m.score)||m.score<c.score||m.score>50000)return;
    c.score=m.score;
    const board=Array.isArray(m.board)&&m.board.length===64&&m.board.every(n=>Number.isInteger(n)&&n>=0&&n<=7)?m.board:null;
    const scores=room.players.map(p=>p.score);
    for(const player of room.players)
      send(player,{type:'scores',scores,slot:c.slot,board:player===c?null:board});
  }else if(m.type==='leave')leave(c);
  else if(m.type==='ping')send(c,{type:'pong'});
}
function connection(socket){
  const c={socket,room:null,slot:0,score:0,closed:false,buffer:Buffer.alloc(0),rate:0,rateStart:0};
  c.send=str=>{
    const body=Buffer.from(str,'utf8');let head;
    if(body.length<126)head=Buffer.from([0x81,body.length]);
    else{head=Buffer.alloc(4);head[0]=0x81;head[1]=126;head.writeUInt16BE(body.length,2);}
    socket.write(Buffer.concat([head,body]));
  };
  const close=()=>{if(c.closed)return;c.closed=true;leave(c,true);};
  socket.on('close',close);socket.on('error',close);
  socket.on('data',part=>{
    c.buffer=Buffer.concat([c.buffer,part]);if(c.buffer.length>4096)return socket.destroy();
    while(c.buffer.length>=2){
      const b=c.buffer,fin=!!(b[0]&128),opcode=b[0]&15,masked=!!(b[1]&128);
      let len=b[1]&127,at=2;
      if(len===126){if(b.length<4)return;len=b.readUInt16BE(2);at=4;}
      if(len===127||len>1024||!masked||!fin)return socket.destroy();
      if(b.length<at+4+len)return;
      const mask=b.subarray(at,at+4),body=Buffer.from(b.subarray(at+4,at+4+len));
      for(let i=0;i<len;i++)body[i]^=mask[i%4];
      c.buffer=b.subarray(at+4+len);
      if(opcode===8){socket.end();return;}
      if(opcode===9){socket.write(Buffer.from([0x8a,body.length,...body]));continue;}
      if(opcode!==1)continue;
      try{receive(c,JSON.parse(body.toString('utf8')))}catch{error(c,'メッセージを読めませんでした');}
    }
  });
  send(c,{type:'hello',version:VERSION,serverTime:stamp()});
}
const server=http.createServer((req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  const url=(req.url||'').split('?')[0];
  if(url==='/health'){res.writeHead(200,{'Content-Type':'application/json'});return res.end(JSON.stringify({ok:true,version:VERSION,rooms:rooms.size}));}
  if(url==='/api/shop/catalog'){
    res.setHeader('Access-Control-Allow-Origin','*');
    res.setHeader('Cache-Control','public, no-cache, must-revalidate');
    res.setHeader('ETag',SHOP_ETAG);
    res.setHeader('Vary','Accept-Encoding');
    if(req.headers['if-none-match']===SHOP_ETAG){res.writeHead(304);return res.end();}
    const gzip=String(req.headers['accept-encoding']||'').split(',').some(x=>x.trim().startsWith('gzip'));
    const bytes=gzip?SHOP_GZIP:SHOP_JSON;
    const headers={'Content-Type':'application/json; charset=utf-8','Content-Length':bytes.length};
    if(gzip)headers['Content-Encoding']='gzip';
    res.writeHead(200,headers);return res.end(bytes);
  }
  if(url==='/download/latest'){
    res.writeHead(200,{
      'Content-Type':'text/html; charset=utf-8',
      'Content-Disposition':'attachment; filename="BlockPop_ONLINE_latest.html"',
      'Content-Length':PAGE.length,
      'Cache-Control':'no-store',
      'Access-Control-Allow-Origin':'*'
    });
    return res.end(PAGE);
  }
  if(url==='/api/version'){res.setHeader('Access-Control-Allow-Origin','*');res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});return res.end(JSON.stringify({version:VERSION,release:'Block Pop! MEGA SHOP v1.2.4',notes:'ショップ62種類！新しいレーザー・爆弾・一斉消去・ブースト・パックと商品検索を追加。',url:'/',downloadUrl:'/download/latest'}));}
  if(url!=='/'&&url!=='/index.html'){res.writeHead(404);return res.end('Not found');}
  res.setHeader('Cache-Control','private, no-cache');
  res.setHeader('ETag',PAGE_ETAG);
  res.setHeader('Vary','Accept-Encoding');
  if(req.headers['if-none-match']===PAGE_ETAG){res.writeHead(304);return res.end();}
  const acceptsGzip=String(req.headers['accept-encoding']||'').split(',').some(x=>x.trim().startsWith('gzip'));
  const body=acceptsGzip?PAGE_GZIP:PAGE;
  const headers={'Content-Type':'text/html; charset=utf-8','Content-Length':body.length};
  if(acceptsGzip)headers['Content-Encoding']='gzip';
  res.writeHead(200,headers);
  res.end(body);
});
server.on('upgrade',(req,socket)=>{
  if((req.url||'').split('?')[0]!=='/ws')return socket.destroy();
  const origin=req.headers.origin,key=req.headers['sec-websocket-key'];
  const validOrigin=!origin||origin==='null'||origin.startsWith('http://localhost:')||origin.startsWith('http://127.0.0.1:')||(()=>{try{return new URL(origin).host===req.headers.host}catch{return false}})();
  if(!validOrigin||typeof key!=='string'||!/^[a-zA-Z0-9+/]{22}==$/.test(key))return socket.destroy();
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  connection(socket);
});
setInterval(()=>{for(const [code,room] of rooms){if((room.status==='lobby'&&stamp()-room.createdAt>3600000)||(room.status==='finished'&&stamp()-room.endsAt>300000))rooms.delete(code)}},60000).unref();
server.listen(PORT,'0.0.0.0',()=>console.log('Block Pop online '+VERSION+' on '+PORT));
