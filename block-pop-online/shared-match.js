'use strict';
/** Server-authoritative, alternating-turn 8x8 multiplayer board.
 *  No arbitrary remote script execution, no trusting client board/score.
 */
const crypto=require('node:crypto');
const SHAPES=[
 [[1]],[[1,1]],[[1,1,1]],[[1,1,1,1]],[[1],[1]],[[1],[1],[1]],
 [[1,1],[1,1]],[[1,1],[1,0]],[[1,1],[0,1]],[[1,0],[1,1]],
 [[1,1,1],[0,1,0]],[[1,0],[1,0],[1,1]],[[1,1,1],[1,0,0]],
 [[1,1,1],[1,1,1]],[[1,1,1],[1,1,1],[1,1,1]]
];
const ALPHABET='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const MAX_MS=5*60*1000,RECONNECT_MS=75*1000;
function rotate(shape){return shape[0].map((_,col)=>shape.map(row=>row[col]).reverse());}
function rotated(shape,n){for(let i=0;i<n;i++)shape=rotate(shape);return shape;}
function fits(board,shape,row,col){
 for(let r=0;r<shape.length;r++)for(let c=0;c<shape[r].length;c++){
  if(!shape[r][c])continue;
  const rr=row+r,cc=col+c;
  if(rr<0||rr>=8||cc<0||cc>=8||board[rr*8+cc]!==0)return false;
 }
 return true;
}
function anyFit(board,pieces){
 for(const p of pieces){if(p.used)continue;
  for(let rot=0;rot<4;rot++){
   const sh=rotated(p.shape,rot);
   for(let row=0;row<=8-sh.length;row++)for(let col=0;col<=8-sh[0].length;col++)if(fits(board,sh,row,col))return true;
  }
 }
 return false;
}
function niceName(v){return String(v||'ゲスト').trim().replace(/[<>\r\n\u0000-\u001f]/g,'').slice(0,16)||'ゲスト';}
function newPieces(){return Array.from({length:3},()=>({shape:SHAPES[crypto.randomInt(SHAPES.length)],color:crypto.randomInt(1,8),used:false}));}
function makeCode(rooms){let id;do{id='S'+Array.from({length:5},()=>ALPHABET[crypto.randomInt(ALPHABET.length)]).join('')}while(rooms.has(id));return id;}
function createSharedMatch({send,leaveLegacy=()=>{},onFinish=()=>{}}){
 const rooms=new Map();const waiting=[];
 function slot(c,name,playerId){return{client:c,name:niceName(name),playerId:/^[a-f0-9]{32}$/.test(String(playerId||''))?playerId:null,token:crypto.randomBytes(24).toString('hex'),score:0,disconnectedAt:0};}
 function roomNew(c,name,playerId){
  const r={code:makeCode(rooms),players:[slot(c,name,playerId),null],board:Array(64).fill(0),pieces:newPieces(),turn:0,seq:0,status:'lobby',createdAt:Date.now(),endsAt:0,timer:null,clearTimer:null,grace:[],mode:'shared'};
  rooms.set(r.code,r);assign(c,r,0);return r;
 }
 function assign(c,r,index){
  if(c.shared)leave(c,'switch');
  r.players[index].client=c;r.players[index].disconnectedAt=0;c.shared={room:r,index};
 }
 function snapshot(r){return{code:r.code,mode:'shared',status:r.status,board:r.board,pieces:r.pieces,turn:r.turn,seq:r.seq,expiresAt:r.endsAt,
  players:r.players.map((p,i)=>p?({slot:i,name:p.name,score:p.score,connected:!!(p.client&&!p.client.closed)}):null)};}
 function broadcast(r,obj){for(const p of r.players)if(p?.client)send(p.client,obj);}
 function publish(r){broadcast(r,{type:'shared_state',state:snapshot(r)});}
 function credentials(c,r,index){send(c,{type:'shared_joined',code:r.code,slot:index,reconnectToken:r.players[index].token});publish(r);}
 function finish(r,reason='time',winner=null){
  if(r.status==='finished')return;
  const previouslyPlaying=r.status==='playing';r.status='finished';clearTimeout(r.timer);for(const id of r.grace)clearTimeout(id);r.grace=[];
  if(winner===null&&r.players[1]){const a=r.players[0].score,b=r.players[1].score;winner=a===b?null:(a>b?0:1);}
  r.endsAt=Date.now();broadcast(r,{type:'shared_finished',reason,winner,state:snapshot(r)});
  if(previouslyPlaying&&(reason==='time'||reason==='no-moves')){
   Promise.resolve().then(()=>onFinish({code:r.code,reason,players:r.players.map(p=>p?({name:p.name,playerId:p.playerId,score:p.score}):null)})).catch(err=>console.warn('Verified match event callback:',err.message));
  }
  r.clearTimer=setTimeout(()=>rooms.delete(r.code),180000);r.clearTimer.unref?.();
 }
 function start(r){
  r.status='playing';r.endsAt=Date.now()+MAX_MS;
  r.timer=setTimeout(()=>finish(r),MAX_MS+50);r.timer.unref?.();publish(r);
 }
 function connectSecond(c,r,name,playerId){
  if(r.status!=='lobby'||r.players[1]||r.players[0].client===c)return send(c,{type:'shared_error',message:'部屋が見つからないか満員だよ'});
  r.players[1]=slot(c,name,playerId);assign(c,r,1);credentials(c,r,1);start(r);
 }
 function dequeue(c){let i=waiting.indexOf(c);if(i!==-1)waiting.splice(i,1);}
 function leave(c,reason='leave'){
  dequeue(c);if(!c.shared)return;
  const {room:r,index}=c.shared;c.shared=null;const p=r.players[index];if(!p||p.client!==c)return;
  p.client=null;p.disconnectedAt=Date.now();
  if(r.status==='lobby'){
   rooms.delete(r.code);const other=r.players[1-index];if(other?.client){other.client.shared=null;send(other.client,{type:'shared_error',message:'ホストが退出したよ'});}
  }else if(r.status==='playing'){
   if(reason==='disconnect'){
    const hold=setTimeout(()=>{if(r.status==='playing'&&!p.client)finish(r,'disconnect',1-index)},RECONNECT_MS);
    hold.unref?.();r.grace.push(hold);publish(r);
   }else{finish(r,'leave',1-index);}
  }
 }
 function disconnect(c){if(c.shared)leave(c,'disconnect');else dequeue(c);}
 function receive(c,m){
  if(!m||typeof m.type!=='string'||!m.type.startsWith('shared_'))return false;
  if(!['shared_create','shared_join','shared_queue','shared_cancel','shared_resume','shared_move','shared_leave'].includes(m.type))return true;
  if(m.type==='shared_cancel'){dequeue(c);send(c,{type:'shared_waiting',waiting:false});return true;}
  if(m.type==='shared_leave'){leave(c);send(c,{type:'shared_left'});return true;}
  if(m.type==='shared_create'||m.type==='shared_join'||m.type==='shared_queue'||m.type==='shared_resume'){
   leaveLegacy(c);if(m.type!=='shared_resume'&&c.shared)leave(c);
  }
  if(m.type==='shared_create'){
   dequeue(c);const r=roomNew(c,m.name,m.playerId);credentials(c,r,0);
  }else if(m.type==='shared_join'){
   dequeue(c);const id=String(m.code||'').trim().toUpperCase();const r=rooms.get(id);
   if(!/^S[A-HJ-NP-Z2-9]{5}$/.test(id)||!r)return send(c,{type:'shared_error',message:'正しい共有ルームコードを入力してね'}),true;
   connectSecond(c,r,m.name,m.playerId);
  }else if(m.type==='shared_queue'){
   dequeue(c);
   let peer;
   while(waiting.length&&!peer){const candidate=waiting.shift();if(candidate!==c&&!candidate.closed&&!candidate.shared)peer=candidate;}
   if(peer){const r=roomNew(peer,peer.waitingName,peer.waitingPlayerId);credentials(peer,r,0);connectSecond(c,r,m.name,m.playerId);}
   else{c.waitingName=niceName(m.name);c.waitingPlayerId=m.playerId;waiting.push(c);send(c,{type:'shared_waiting',waiting:true});}
  }else if(m.type==='shared_resume'){
   const id=String(m.code||'').trim().toUpperCase(),token=String(m.token||'');const r=rooms.get(id);
   const index=r?.players.findIndex(p=>p&&p.token===token);
   if(index===undefined||index<0||!r)return send(c,{type:'shared_error',message:'再接続データが無効か、部屋が終了したよ'}),true;
   const p=r.players[index];if(p.client&&p.client!==c){p.client.shared=null;send(p.client,{type:'shared_error',message:'別端末から再接続されました'});}
   assign(c,r,index);credentials(c,r,index);
   if(r.status==='finished')send(c,{type:'shared_finished',reason:'already-ended',winner:null,state:snapshot(r)});
  }else if(m.type==='shared_move'){
   const link=c.shared;if(!link)return send(c,{type:'shared_error',message:'共有対戦に参加していないよ'}),true;
   const r=link.room;
   if(r.status!=='playing')return send(c,{type:'shared_error',message:'対戦は終了しているよ'}),true;
   if(Date.now()>r.endsAt)return finish(r),true;
   if(r.turn!==link.index)return send(c,{type:'shared_error',message:'いまは相手の番だよ'}),true;
   if(![m.piece,m.row,m.col,m.rotation,m.seq].every(Number.isInteger))return true;
   if(m.seq!==r.seq)return send(c,{type:'shared_error',message:'盤面を同期し直したよ'}),publish(r),true;
   if(m.piece<0||m.piece>2||m.row<0||m.row>7||m.col<0||m.col>7||m.rotation<0||m.rotation>3)return true;
   const piece=r.pieces[m.piece];if(!piece||piece.used)return true;
   const sh=rotated(piece.shape,m.rotation);if(!fits(r.board,sh,m.row,m.col))return send(c,{type:'shared_error',message:'そこには置けないよ'}),true;
   let blocks=0;for(let a=0;a<sh.length;a++)for(let b=0;b<sh[a].length;b++)if(sh[a][b]){r.board[(m.row+a)*8+m.col+b]=piece.color;blocks++;}
   const rows=[],cols=[];
   for(let a=0;a<8;a++)if(r.board.slice(a*8,a*8+8).every(Boolean))rows.push(a);
   for(let b=0;b<8;b++){let filled=true;for(let a=0;a<8;a++)if(!r.board[a*8+b]){filled=false;break;}if(filled)cols.push(b);}
   let erased=0;const cleared=new Set();for(const a of rows)for(let b=0;b<8;b++)cleared.add(a*8+b);
   for(const b of cols)for(let a=0;a<8;a++)cleared.add(a*8+b);
   for(const at of cleared){r.board[at]=0;erased++;}
   r.players[link.index].score+=blocks+10*(rows.length+cols.length)+erased;
   piece.used=true;if(r.pieces.every(p=>p.used))r.pieces=newPieces();
   r.seq++;r.turn=1-r.turn;publish(r);
   if(!anyFit(r.board,r.pieces))finish(r,'no-moves');
  }
  return true;
 }
 function info(){return{sharedRooms:rooms.size,waitingPlayers:waiting.filter(x=>!x.closed).length};}
 return{receive,disconnect,leave,info};
}
module.exports=createSharedMatch;
module.exports._test={rotate,rotated,fits,anyFit};
