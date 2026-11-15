export const WORLD = 14;
export const WEAPONS = {
 pistol:{name:'ピストル',tag:'STANDARD',damage:25,interval:.45,range:32,price:0,ammo:Infinity},
 rifle:{name:'ラピッドライフル',tag:'RAPID',damage:16,interval:.14,range:32,price:280,ammo:90,refill:60,pickup:20},
 rail:{name:'パルスライフル',tag:'POWER',damage:60,interval:1.05,range:40,price:550,ammo:18,refill:12,pickup:5},
 spark:{name:'スパークSMG',tag:'SPEED',damage:11,interval:.12,range:20,price:190,ammo:120,refill:90,pickup:30,art:'rifle'},
 scatter:{name:'ワイドブラスター',tag:'WIDE',damage:42,interval:.8,range:14,price:420,ammo:24,refill:18,pickup:6,radius:1.15,art:'rifle'},
 ranger:{name:'ロングレンジャー',tag:'LONG RANGE',damage:85,interval:1.6,range:55,price:850,ammo:10,refill:8,pickup:3,art:'rail'}
};
export const GOODS = {
 rifle:{price:280,label:'ラピッドライフル',category:'weapons',description:'素早い連射。弾薬90発付き。'},
 rail:{price:550,label:'パルスライフル',category:'weapons',description:'狙いを定めて大きな一撃。弾薬18発付き。'},
 spark:{price:190,label:'スパークSMG',category:'weapons',description:'買いやすい近距離連射タイプ。弾薬120発付き。'},
 scatter:{price:420,label:'ワイドブラスター',category:'weapons',description:'近距離で狙いの幅が広い一撃。複数人への同時命中はなし。弾薬24発付き。'},
 ranger:{price:850,label:'ロングレンジャー',category:'weapons',description:'遠くに届く高威力タイプ。連射はゆっくり。弾薬10発付き。'},
 ammo:{price:80,label:'弾薬パック',category:'support',description:'持っている購入銃すべてに弾薬を補充。銃ごとに補充数が違います。',ammoMultiplier:1},
 revive:{price:160,label:'復活シールド',category:'support',description:'倒されたときに自動復活。4秒間シールド。1回分。',item:'revive',quantity:1},
 medkit:{price:100,label:'回復キット',category:'support',description:'対戦中にボタンでHPを40回復。最大100。HP満タンなら消費しません。',item:'medkit',quantity:1},
 shield:{price:140,label:'ポケットシールド',category:'support',description:'ボタンで5秒間ダメージを防ぐ。発射すると解除。1回分。',item:'shield',quantity:1},
 grenade:{price:70,label:'ボム ×3',category:'explosives',description:'狙った方向へ投げる範囲攻撃。3個入り。省エネ中は使用不可。',item:'grenade',quantity:3},
 premium:{price:110,label:'強化地雷 ×2',category:'explosives',description:'広い範囲に80ダメージ。2個入り。省エネ中は使用不可。',item:'premium',quantity:2},
 ammoLarge:{price:200,label:'大容量弾薬パック',category:'packs',description:'通常の弾薬パック3個分をまとめて補充。40コインお得。',ammoMultiplier:3},
 revivePack:{price:420,label:'復活セット ×3',category:'packs',description:'復活シールド3回分。単品3個より60コインお得。',item:'revive',quantity:3},
 grenadePack:{price:200,label:'ボムセット ×10',category:'packs',description:'ボム10個を補充。省エネ中は使用できません。',item:'grenade',quantity:10},
 premiumPack:{price:400,label:'強化地雷セット ×8',category:'packs',description:'強化地雷8個を補充。通常4セットより40コインお得。',item:'premium',quantity:8}
};
export function normalizeProfile(p){
 p.owned=Array.isArray(p.owned)?[...new Set(p.owned.filter(k=>Object.hasOwn(WEAPONS,k)))]:['pistol'];if(!p.owned.includes('pistol'))p.owned.unshift('pistol');
 p.ammo=p.ammo&&typeof p.ammo==='object'?p.ammo:{};
 for(const k of Object.keys(WEAPONS))if(k!=='pistol'&&(!Number.isFinite(p.ammo[k])||p.ammo[k]<0))p.ammo[k]=0;
 for(const k of ['revive','grenade','premium','medkit','shield'])if(!Number.isFinite(p[k])||p[k]<0)p[k]=0;
 return p;
}
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
  return normalizeProfile({id,name,coins:500,owned:['pistol'],ammo:{rifle:0,rail:0},revive:0,grenade:3,premium:0,wins:0,kills:0,friends:[],created:Date.now()});
}
export function purchase(profile,key){
 const g=Object.hasOwn(GOODS,key)?GOODS[key]:null;if(!g)return 'この商品はありません';normalizeProfile(profile);
 if(WEAPONS[key]&&profile.owned.includes(key))return 'この武器は持っています';
 if(profile.coins<g.price)return 'コインが足りません';
 if(g.ammoMultiplier&&profile.owned.length===1)return '先に銃を購入してください';
 profile.coins-=g.price;
 if(WEAPONS[key]){profile.owned.push(key);profile.ammo[key]+=WEAPONS[key].ammo;}
 else if(g.ammoMultiplier){for(const k of profile.owned)if(k!=='pistol')profile.ammo[k]+=WEAPONS[k].refill*g.ammoMultiplier;}
 else profile[g.item]+=g.quantity;
 return null;
}
export function makePlayer(profile, opts={}) {
  normalizeProfile(profile);
  return {id:profile.id,name:profile.name,profile,x:opts.x??0,y:opts.y??-8,z:0,yaw:0,pitch:0,hp:100,score:0,weapon:'pistol',low:!!opts.low,physical:!!opts.physical,alive:true,cool:0,shield:0,jumpCool:0,mineCool:0,input:{mx:0,my:0,turn:0,tilt:0,fire:false},lastInput:0,ready:false};
}
export function createMatch(players, {random=Math.random}={}) {
  const g={players:[...players],practice:false,t:0,duration:150,status:'playing',items:[],mines:[],bombs:[],effects:[],events:[],serial:0,random,result:null};
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
    else {p.alive=false; if(attacker && attacker.id!==p.id){attacker.score++;attacker.profile.coins+=80;attacker.profile.kills++;emit(g,attacker,p.name+'を撃破！ +80','kill');}}
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
  for(const target of g.players){if(target===p||!target.alive)continue;const d=rayHit(origin,dir,{x:target.x,y:target.y,z:target.z+.65},w.range,w.radius??.65);if(d!==null&&d<nearest){best=target;nearest=d;}}
  g.effects.push({id:++g.serial,type:'shot',from:origin,to:{x:origin.x+dir.x*nearest,y:origin.y+dir.y*nearest,z:origin.z+dir.z*nearest},owner:p.id,hit:!!best,until:g.t+.2});
  if(best){damage(g,best,w.damage,p);emit(g,p,'命中！','hit');}
  return true;
}
export function action(g,p,type,value) {
  if(g.status!=='playing'||!p.alive)return;
  if(type==='fire')fire(g,p);
  if(type==='weapon'&&p.profile.owned.includes(value))p.weapon=value;
  if(type==='medkit'){if(p.profile.medkit<=0){emit(g,p,'回復キットがありません','item');return;}if(p.hp>=100){emit(g,p,'HPは満タンです','item');return;}p.profile.medkit--;p.hp=Math.min(100,p.hp+40);emit(g,p,'回復キットを使用。HP '+p.hp,'item');}
  if(type==='shield'){if(p.profile.shield<=0){emit(g,p,'ポケットシールドがありません','item');return;}if(p.shield>g.t){emit(g,p,'シールドはすでに有効です','item');return;}p.profile.shield--;p.shield=g.t+5;emit(g,p,'シールド。5秒間防御','item');}
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
  for(const p of g.players)if(p.alive&&p.id!==m.owner&&distance(p,m)<radius)damage(g,p,power,owner);
}
export function tick(g,dt=.05) {
  if(g.status!=='playing')return;
  g.t+=dt;
  for(const p of g.players) {
    if(!p.alive)continue;
    {
      const input=g.t-p.lastInput<.8?p.input:{mx:0,my:0,turn:0,tilt:0,fire:false};
      const len=Math.hypot(input.mx,input.my)||1;
      if(!p.physical){p.x=clamp(p.x+input.mx/Math.max(1,len)*2.6*dt,-WORLD,WORLD);p.y=clamp(p.y+input.my/Math.max(1,len)*2.6*dt,-WORLD,WORLD);}
      p.yaw+=input.turn*1.4*dt;p.pitch=clamp(p.pitch+input.tilt*1.05*dt,-1.35,1.35);
      if(input.fire)fire(g,p);
    }
    for(const item of g.items)if(item.active&&distance(p,item)<1.1){
      item.active=false;item.respawn=g.t+16;
      if(item.type==='coins'){p.profile.coins+=40;emit(g,p,'コイン +40','pickup');}
      if(item.type==='ammo'){for(const k of p.profile.owned)if(k!=='pistol')p.profile.ammo[k]+=WEAPONS[k].pickup;emit(g,p,'弾薬を拾った！','pickup');}
      if(item.type==='health'){p.hp=Math.min(100,p.hp+35);emit(g,p,'HP +35','pickup');}
      if(item.type==='grenade'){p.profile.grenade++;emit(g,p,'ボム +1','pickup');}
    }
  }
  for(const i of g.items)if(!i.active&&g.t>i.respawn)i.active=true;
  g.mines=g.mines.filter(m=>{if(g.t>m.until)return false;if(g.t>m.arm&&g.players.some(p=>p.alive&&p.id!==m.owner&&distance(p,m)<1.1)){explode(g,m,m.premium?3:2,m.premium?80:40);return false;}return true;});
  g.bombs=g.bombs.filter(m=>{if(g.t>=m.until){explode(g,m,3,55);return false;}return true;});
  g.effects=g.effects.filter(e=>e.until>g.t);
  const humans=g.players,live=humans.filter(p=>p.alive);
  let ended=humans.some(p=>p.score>=5)||g.t>=g.duration||live.length===0||(humans.length>1&&live.length<=1);
  if(ended){g.status='ended';let winner=null;{const sorted=[...live].sort((a,b)=>b.score-a.score||b.hp-a.hp);if(sorted.length===1||sorted.length>1&&(sorted[0].score!==sorted[1].score||sorted[0].hp!==sorted[1].hp))winner=sorted[0];}
    if(winner){winner.profile.coins+=150;winner.profile.wins++;}else for(const p of humans)p.profile.coins+=30;
    g.result={winner:winner?.id??null,reason:g.t>=g.duration?'時間切れ':'勝負あり'};
  }
}
export function snapshot(g,selfId) {
  return {status:g.status,t:g.t,duration:g.duration,practice:false,result:g.result,
    players:g.players.map(p=>({id:p.id,name:p.name,x:p.x,y:p.y,z:p.z,yaw:p.yaw,pitch:p.pitch,hp:p.hp,score:p.score,weapon:p.weapon,alive:p.alive,shield:Math.max(0,p.shield-g.t),low:p.low,physical:p.physical})),
    items:g.items.filter(i=>i.active),mines:g.mines,bombs:g.bombs,effects:g.effects,events:g.events.filter(e=>!e.player||e.player===selfId)};
}
