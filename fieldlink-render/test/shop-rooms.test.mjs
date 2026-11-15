import test from 'node:test';
import assert from 'node:assert/strict';
import {WEAPONS,GOODS,newProfile,normalizeProfile,purchase,makePlayer,createMatch,action,fire,damage,tick} from '../public/engine.mjs';
import {roomCode,roomIntent} from '../public/rooms.mjs';
test('entering any room code or link selects joining, never new creation',()=>{
 assert.equal(roomIntent(''),'create');assert.equal(roomIntent('  '),'create');
 for(const value of ['1234ABCD','bad code','https://fieldlink-arena-yuuki.onrender.com/?room=1234abcd'])assert.equal(roomIntent(value),'join');
 assert.equal(roomCode(' ａｂｃｄ－１２３４ '),'ABCD1234');assert.equal(roomCode('https://fieldlink-arena-yuuki.onrender.com/?room=1234abcd'),'1234ABCD');assert.equal(roomCode('1234567890'),null);
});
test('every store item can be purchased and grants exactly its stated contents',()=>{
 assert.equal(Object.keys(GOODS).length,15);
 for(const [key,good] of Object.entries(GOODS)){
  const p=newProfile(key);p.coins=10000;if(good.ammoMultiplier)for(const k of Object.keys(WEAPONS).filter(k=>k!=='pistol'))purchase(p,k);
  const coins=p.coins,ammo={...p.ammo},count=p[good.item];assert.equal(purchase(p,key),null);assert.equal(p.coins,coins-good.price);
  if(WEAPONS[key]){assert.ok(p.owned.includes(key));assert.equal(p.ammo[key],WEAPONS[key].ammo);}
  else if(good.ammoMultiplier){for(const k of p.owned.filter(k=>k!=='pistol'))assert.equal(p.ammo[k]-ammo[k],WEAPONS[k].refill*good.ammoMultiplier);}
  else assert.equal(p[good.item]-count,good.quantity);
 }
});
test('old inventories gain new fields without losing coins, weapons or ammunition',()=>{
 const p={id:'old',name:'old',coins:789,owned:['pistol','rail'],ammo:{rail:7,rifle:0},revive:2,grenade:4,premium:1};normalizeProfile(p);
 assert.equal(p.coins,789);assert.equal(p.ammo.rail,7);assert.equal(p.revive,2);assert.equal(p.medkit,0);assert.equal(p.shield,0);
 assert.equal(purchase(p,'spark'),null);assert.equal(p.ammo.spark,120);assert.ok(Number.isFinite(p.ammo.ranger));
});
test('healing consumes only when useful and cannot exceed maximum HP',()=>{
 const p=makePlayer(newProfile('a')),b=makePlayer(newProfile('b'));const g=createMatch([p,b]);p.profile.medkit=2;
 action(g,p,'medkit');assert.equal(p.profile.medkit,2);p.hp=80;action(g,p,'medkit');assert.equal(p.hp,100);assert.equal(p.profile.medkit,1);
 p.hp=10;action(g,p,'medkit');assert.equal(p.hp,50);assert.equal(p.profile.medkit,0);action(g,p,'medkit');assert.equal(p.hp,50);
});
test('pocket shield blocks damage, cannot stack, expires and ends when firing',()=>{
 const p=makePlayer(newProfile('a')),b=makePlayer(newProfile('b'));const g=createMatch([p,b]);p.profile.shield=3;
 action(g,p,'shield');assert.equal(p.profile.shield,2);action(g,p,'shield');assert.equal(p.profile.shield,2);damage(g,p,25,b);assert.equal(p.hp,100);
 g.t=5.1;damage(g,p,25,b);assert.equal(p.hp,75);action(g,p,'shield');fire(g,p);assert.equal(p.shield,0);damage(g,p,25,b);assert.equal(p.hp,50);
});
test('all new weapons consume ammunition, respect cadence and have distinct effective ranges',()=>{
 for(const k of ['spark','scatter','ranger']){const p=makePlayer(newProfile('a'),{x:0,y:0}),b=makePlayer(newProfile('b'),{x:0,y:5});const g=createMatch([p,b]);p.profile.coins=10000;purchase(p.profile,k);action(g,p,'weapon',k);const ammo=p.profile.ammo[k];fire(g,p);assert.equal(b.hp,100-WEAPONS[k].damage);assert.equal(p.profile.ammo[k],ammo-1);assert.equal(fire(g,p),false);}
 const p=makePlayer(newProfile('a'),{x:0,y:0}),b=makePlayer(newProfile('b'),{x:0,y:30});const g=createMatch([p,b]);p.profile.coins=10000;purchase(p.profile,'spark');purchase(p.profile,'ranger');action(g,p,'weapon','spark');fire(g,p);assert.equal(b.hp,100);g.t=2;action(g,p,'weapon','ranger');fire(g,p);assert.equal(b.hp,15);
});
test('large ammo pack requires a purchased weapon and wide weapon hits off center only within short range',()=>{
 const p=newProfile('a');const coins=p.coins;assert.equal(purchase(p,'ammoLarge'),'先に銃を購入してください');assert.equal(p.coins,coins);
 const a=makePlayer(p,{x:0,y:0}),b=makePlayer(newProfile('b'),{x:1,y:5});const g=createMatch([a,b]);fire(g,a);assert.equal(b.hp,100);p.coins=500;purchase(p,'scatter');action(g,a,'weapon','scatter');g.t=1;fire(g,a);assert.equal(b.hp,58);
});
