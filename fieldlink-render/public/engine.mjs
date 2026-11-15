export const WORLD = 14;
export const WEAPONS = {
  pistol: { name: 'ピストル', tag: 'STANDARD', damage: 25, interval: .45, range: 32, price: 0, ammo: Infinity },
  rifle: { name: 'ラピッドライフル', tag: 'RAPID', damage: 16, interval: .14, range: 32, price: 280, ammo: 90 },
  rail: { name: 'パルスライフル', tag: 'POWER', damage: 60, interval: 1.05, range: 40, price: 550, ammo: 18 }
};
export const GOODS = {
  rifle: { price: 280, label: 'ラピッドライフル' }, rail: { price: 550, label: 'パルスライフル' },
  ammo: { price: 80, label: '弾薬パック' }, revive: { price: 160, label: '復活シールド' },
  grenade: { price: 70, label: 'ボム ×3' }, premium: { price: 110, label: '強化地雷 ×2' }
};
export const DIFFICULTIES = ['簡単', '普通', '難しい', '難しすぎる'];
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const distance = (a, b) => Math.hypot(a.x-b.x, a.y-b.y, (a.z||0)-(b.z||0));
export const direction = (yaw, pitch) => ({x:Math.sin(yaw)*Math.cos(pitch),y:Math.cos(yaw)*Math.cos(pitch),z:Math.sin(pitch)});
export function rayHit(origin, dir, target, range=32, radius=.65) {
  const x=target.x-origin.x,y=target.y-origin.y,z=target.z-origin.z;
  const along=x*dir.x+y*dir.y+z*dir.z;
  const cross2=x*x+y*y+z*z-along*along;
  if(along < 0 || cross2>radius*radius) return null;
  const hit=Math.max(0,along-Math.sqrt(Math.max(0,radius*radius-cross2)));
  return hit<=range ? hit : null;
}
export function newProfile(id, name='プレイヤー') {
  return {id,name,coins:500,owned:['pistol'],ammo:{rifle:0,rail:0},revive:0,grenade:3,premium:0,wins:0,kills:0,friends:[],created:Date.now()};
}
export function purchase(profile, key) {
  const g=GOODS[key];
  if(!g) return 'この商品はありません';
  if(profile.coins<g.price) return 'コインが足りません';
  if(WEAPONS[key] && profile.owned.includes(key)) return 'この武器は持っています';
  if(key==='ammo' && profile.owned.length===1) return '先に銃を購入してください';
  profile.coins-=g.price;
  if(WEAPONS[key]) { profile.owned.push(key); profile.ammo[key]+=WEAPONS[key].ammo; }
  else if(key==='ammo') { if(profile.owned.includes('rifle')) profile.ammo.rifle+=60; if(profile.owned.includes('rail')) profile.ammo.rail+=12; }
  else profile[key]+=(key==='grenade'?3:key==='premium'?2:1);
  return null;
}
export function makePlayer(profile, opts={}) {
  return {id:profile.id,name:profile.name,profile,x:opts.x??0,y:opts.y??-8,z:0,yaw:0,pitch:0,hp:100,score:0,weapon:'pistol',low:!!opts.low,physical:!!opts.physical,bot:!!opts.bot,alive:true,cool:0,shield:0,jumpCool:0,mineCool:0,input:{mx:0,my:0,turn:0,tilt:0,fire:false},lastInput:0,ready:false};
}
export function createMatch(players, {difficulty=1, practice=true, random=Math.random}={}) {
  const g={players:[...players],practice,difficulty:clamp(difficulty,0,3),t:0,duration:150,status:'playing',items:[],mines:[],bombs:[],effects:[],events:[],serial:0,random,result:null};
  if(practice) {
    const spots=[[-5,5,0],[5,8,2],[0,11,0]];
    spots.forEach((s,i)=>{const p=makePlayer(newProfile('npc-'+i,'NPC '+String(i+1).padStart(2,'0')),{x:s[0],y:s[1],bot:true});p.z=s[2];p.think=2+i;p.profile.grenade=999;g.players.push(p);});
  }
  for(let i=0;i<8;i++)g.items.push({id:++g.serial,x:(random()-.5)*22,y:(random()-.5)*22,z:0,type:['coins','ammo','health','grenade'][i%4],active:true,respawn:0});
  // One nearby item lets the first-time player discover the proximity cue immediately.
  g.items[0].x=2;g.items[0].y=-7;
  return g;
}
function emit(g,p,text,kind='info') {g.events.push({id:++g.serial,player:p?.id??null,text,kind,time:g.t});if(g.events.length>24)g.events.shift();}
export function damage(g,p,amount,attacker) {
  if(!p.alive || p.shield>g.t) return false;
  p.hp=Math.max(0,p.hp-amount);emit(g,p,'ダメージ −'+amount,'damage');
  if(p.hp===0) {
    if(p.profile.revive>0) {p.profile.revive--;p.hp=100;p.shield=g.t+4;emit(g,p,'復活！ 4秒間シールド','revive');}
    else {p.alive=false;p.respawn=g.t+3; if(attacker && attacker.id!==p.id){attacker.score++;if(!attacker.bot){attacker.profile.coins+=80;attacker.profile.kills++;}emit(g,attacker,p.name+'を撃破！ +80','kill');}}
  }
  return true;
}
export function fire(g,p) {
  if(g.status!=='playing'||!p.alive||g.t<p.cool) return false;
  const w=WEAPONS[p.weapon];
  if(p.weapon!=='pistol' && p.profile.ammo[p.weapon]<=0) {p.cool=g.t+.4;emit(g,p,'弾切れ！ ピストルに切り替えよう','empty');return false;}
  if(p.weapon!=='pistol')p.profile.ammo[p.weapon]--;
  p.cool=g.t+w.interval;p.shield=0;
  const origin={x:p.x,y:p.y,z:p.z+.65},dir=direction(p.yaw,p.pitch);
  let best=null,nearest=w.range;
  for(const target of g.players){if(target===p||!target.alive||(p.bot&&target.bot))continue;const d=rayHit(origin,dir,{x:target.x,y:target.y,z:target.z+.65},w.range);if(d!==null&&d<nearest){best=target;nearest=d;}}
  g.effects.push({id:++g.serial,type:'shot',from:origin,to:{x:origin.x+dir.x*nearest,y:origin.y+dir.y*nearest,z:origin.z+dir.z*nearest},owner:p.id,hit:!!best,until:g.t+.2});
  if(best){damage(g,best,w.damage,p);emit(g,p,'命中！','hit');}
  return true;
}
export function action(g,p,type,value) {
  if(g.status!=='playing'||!p.alive)return;
  if(type==='fire')fire(g,p);
  if(type==='weapon'&&p.profile.owned.includes(value))p.weapon=value;
  if(type==='jump'&&!p.low&&g.t>=p.jumpCool){p.z=Math.min(4,p.z+1);p.jumpCool=g.t+.45;emit(g,p,'高さ '+p.z);}
  if(type==='down'&&g.t>=p.jumpCool){p.z=Math.max(0,p.z-1);p.jumpCool=g.t+.3;}
  if(type==='mine'||type==='premium') {
    if(p.low){emit(g,p,'省エネ中は爆発物を使えません');return;}
    if(g.t<p.mineCool)return;
    if(type==='premium'&&p.profile.premium<=0){emit(g,p,'強化地雷がありません');return;}
    if(type==='premium')p.profile.premium--;
    const mine={id:++g.serial,x:p.x,y:p.y,z:p.z,owner:p.id,arm:g.t+1.5,until:g.t+60,premium:type==='premium'};
    const own=g.mines.filter(m=>m.owner===p.id);if(own.length>=3)g.mines=g.mines.filter(m=>m.id!==own[0].id);
    g.mines.push(mine);p.mineCool=g.t+1;emit(g,p,type==='premium'?'強化地雷を設置':'地雷を設置');
  }
  if(type==='grenade') {
    if(p.low){emit(g,p,'省エネ中は爆発物を使えません');return;}
    if(p.profile.grenade<=0||g.t<p.mineCool){emit(g,p,'ボムがありません・準備中です');return;}
    p.profile.grenade--;p.mineCool=g.t+.7;
    const d=direction(p.yaw,p.pitch);g.bombs.push({id:++g.serial,x:clamp(p.x+d.x*5,-WORLD,WORLD),y:clamp(p.y+d.y*5,-WORLD,WORLD),z:clamp(p.z+d.z*5,0,4),owner:p.id,until:g.t+1.4});emit(g,p,'ボム投てき！');
  }
}
function explode(g,m,radius,power) {
  g.effects.push({id:++g.serial,type:'blast',x:m.x,y:m.y,z:m.z,radius,until:g.t+.6});
  const owner=g.players.find(p=>p.id===m.owner);
  for(const p of g.players)if(p.alive&&p.id!==m.owner&&!(owner?.bot&&p.bot)&&distance(p,m)<radius)damage(g,p,power,owner);
}
function npc(g,p,dt) {
  const target=g.players.find(t=>!t.bot&&t.alive);if(!target)return;
  const dx=target.x-p.x,dy=target.y-p.y,len=Math.hypot(dx,dy),d=g.difficulty;
  const move=d===0?.32:d===1?.65:d===2?1:1.35;
  if(len>5){p.x+=dx/len*dt*move;p.y+=dy/len*dt*move;}else if(d>0){p.x+=Math.cos(g.t+p.x)*dt*move;p.y+=Math.sin(g.t+p.y)*dt*move;}
  p.x=clamp(p.x,-WORLD,WORLD);p.y=clamp(p.y,-WORLD,WORLD);
  p.yaw=Math.atan2(dx,dy);p.pitch=Math.atan2(target.z-p.z,Math.max(.01,len));
  p.think-=dt;
  if(p.think<=0){const error=[.45,.23,.10,.035][d];p.yaw+=(g.random()-.5)*error;p.pitch+=(g.random()-.5)*error;fire(g,p);p.think=[2.5,1.6,.95,.6][d]+g.random()*.3;if(d>=2&&g.random()<.14)action(g,p,'grenade');}
}
export function tick(g,dt=.05) {
  if(g.status!=='playing')return;
  g.t+=dt;
  for(const p of g.players) {
    if(!p.alive){if(p.bot&&g.t>p.respawn){p.alive=true;p.hp=100;p.x=(g.random()-.5)*20;p.y=8+g.random()*4;p.shield=g.t+1;}continue;}
    if(p.bot)npc(g,p,dt);
    else {
      const input=g.t-p.lastInput<.8?p.input:{mx:0,my:0,turn:0,tilt:0,fire:false};
      const len=Math.hypot(input.mx,input.my)||1;
      if(!p.physical){p.x=clamp(p.x+input.mx/Math.max(1,len)*2.6*dt,-WORLD,WORLD);p.y=clamp(p.y+input.my/Math.max(1,len)*2.6*dt,-WORLD,WORLD);}
      p.yaw+=input.turn*1.4*dt;p.pitch=clamp(p.pitch+input.tilt*1.05*dt,-1.35,1.35);
      if(input.fire)fire(g,p);
    }
    for(const item of g.items)if(item.active&&distance(p,item)<1.1&&!p.bot){
      item.active=false;item.respawn=g.t+16;
      if(item.type==='coins'){p.profile.coins+=40;emit(g,p,'コイン +40','pickup');}
      if(item.type==='ammo'){for(const k of ['rifle','rail'])if(p.profile.owned.includes(k))p.profile.ammo[k]+=(k==='rifle'?20:5);emit(g,p,'弾薬を拾った！','pickup');}
      if(item.type==='health'){p.hp=Math.min(100,p.hp+35);emit(g,p,'HP +35','pickup');}
      if(item.type==='grenade'){p.profile.grenade++;emit(g,p,'ボム +1','pickup');}
    }
  }
  for(const i of g.items)if(!i.active&&g.t>i.respawn)i.active=true;
  g.mines=g.mines.filter(m=>{if(g.t>m.until)return false;if(g.t>m.arm&&g.players.some(p=>p.alive&&p.id!==m.owner&&distance(p,m)<1.1)){explode(g,m,m.premium?3:2,m.premium?80:40);return false;}return true;});
  g.bombs=g.bombs.filter(m=>{if(g.t>=m.until){explode(g,m,3,55);return false;}return true;});
  g.effects=g.effects.filter(e=>e.until>g.t);
  const humans=g.players.filter(p=>!p.bot),live=humans.filter(p=>p.alive);
  let ended=humans.some(p=>p.score>=5)||g.t>=g.duration||live.length===0||(!g.practice&&humans.length>1&&live.length<=1);
  if(ended){g.status='ended';let winner=null;if(g.practice)winner=humans[0].alive&&humans[0].score>=5?humans[0]:null;else{const sorted=[...live].sort((a,b)=>b.score-a.score||b.hp-a.hp);if(sorted.length===1||sorted.length>1&&(sorted[0].score!==sorted[1].score||sorted[0].hp!==sorted[1].hp))winner=sorted[0];}
    if(winner){winner.profile.coins+=150;winner.profile.wins++;}else for(const p of humans)p.profile.coins+=30;
    g.result={winner:winner?.id??null,reason:g.t>=g.duration?'時間切れ':g.practice?(winner?'5体撃破！':'HPがなくなりました'):'勝負あり'};
  }
}
export function snapshot(g,selfId) {
  return {status:g.status,t:g.t,duration:g.duration,practice:g.practice,difficulty:g.difficulty,result:g.result,
    players:g.players.map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch,hp:p.hp,score:p.score,weapon:p.weapon,alive:p.alive,shield:Math.max(0,p.shield-g.t),bot:p.bot,low:p.low,physical:p.physical})),
    items:g.items.filter(i=>i.active),mines:g.mines,bombs:g.bombs,effects:g.effects,events:g.events.filter(e=>!e.player||e.player===selfId)};
}
