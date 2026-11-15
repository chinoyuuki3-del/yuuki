import test from 'node:test';
import assert from 'node:assert/strict';
import {locationAccess} from '../public/location.mjs';
function fixture(permission='prompt'){
 const calls=[],states=[],positions=[];let current,watch,timer;const status={state:permission};
 const nav={permissions:{async query(){return status;}},geolocation:{
  getCurrentPosition(ok,fail,options){calls.push(['request',options]);current={ok,fail};},
  watchPosition(ok,fail){calls.push(['watch']);watch={ok,fail};return 7;},
  clearWatch(id){calls.push(['clear',id]);}
 }};
 const access=locationAccess({nav,onState:s=>states.push(s),onPosition:p=>positions.push(p),setTimer:fn=>{timer=fn;return 1;},clearTimer:()=>{timer=null;}});
 return {access,calls,states,positions,status,current:()=>current,watch:()=>watch,timer:()=>timer?.()};
}
const position={coords:{latitude:35,longitude:139,accuracy:8}};
test('request happens in the button call; inspecting permission never requests location',async()=>{
 const f=fixture();await f.access.inspect();assert.equal(f.calls.length,0);
 f.access.request();assert.equal(f.calls[0][0],'request');assert.equal(f.access.state.phase,'requesting');
 assert.equal(f.calls[0][1].maximumAge,0);assert.equal(f.calls[0][1].enableHighAccuracy,true);
 f.current().ok(position);assert.equal(f.access.state.phase,'ready');assert.equal(f.positions.length,1);assert.equal(f.calls[1][0],'watch');
});
test('denial is recoverable and permission changes allow retry',async()=>{
 const f=fixture();await f.access.inspect();f.access.request();f.current().fail({code:1});assert.equal(f.access.state.phase,'denied');assert.equal(f.access.state.position,null);
 f.status.state='granted';f.status.onchange();assert.equal(f.access.state.phase,'idle');f.access.request();f.current().ok(position);assert.equal(f.access.state.phase,'ready');
 f.status.state='denied';f.status.onchange();assert.equal(f.access.state.position,null);assert.deepEqual(f.calls.at(-1),['clear',7]);
});
test('missing permission dialog gets help; timeout does not permanently disable retry',()=>{
 const f=fixture();f.access.request();f.timer();assert.equal(f.access.state.phase,'waiting');f.current().fail({code:3});assert.equal(f.access.state.phase,'timeout');f.access.request();f.current().ok(position);assert.equal(f.access.state.phase,'ready');
});
test('retry ignores old callbacks and avoids duplicate location watches',()=>{
 const f=fixture();f.access.request();const old=f.current();f.access.request();old.ok(position);assert.equal(f.positions.length,0);f.current().ok(position);f.access.request();assert.deepEqual(f.calls.at(-2),['clear',7]);
});
test('permission API absence still requests location and coarse accuracy is shown honestly',async()=>{
 const states=[];let requested=false;const access=locationAccess({nav:{geolocation:{getCurrentPosition(ok){requested=true;ok({coords:{latitude:35,longitude:139,accuracy:500}});},watchPosition(){return 1;},clearWatch(){}}},onState:s=>states.push(s),onPosition:()=>{}});
 await access.inspect();access.request();assert.equal(requested,true);assert.equal(access.state.position.accuracy,500);access.stop();
});
