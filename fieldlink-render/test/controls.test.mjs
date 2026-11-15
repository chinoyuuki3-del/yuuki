import test from 'node:test';
import assert from 'node:assert/strict';
import {keyboardInput,headingText} from '../public/controls.mjs';
import {friendCode,friendCodeError} from '../public/friends.mjs';
import {makePlayer,newProfile,createMatch,tick} from '../public/engine.mjs';
test('arrow movement and WASD aiming are independent, including held opposing keys',()=>{
 const p=makePlayer(newProfile('a'),{x:0,y:0}),other=makePlayer(newProfile('b'),{x:10,y:10});const g=createMatch([p,other]);
 p.input=keyboardInput(new Set(['KeyD','KeyW']));tick(g,.1);assert.ok(p.yaw>0);assert.ok(p.pitch>0);assert.equal(p.x,0);assert.equal(p.y,0);
 const yaw=p.yaw,pitch=p.pitch;p.input=keyboardInput(new Set(['ArrowRight']));tick(g,.1);assert.ok(p.x>0);assert.equal(p.yaw,yaw);assert.equal(p.pitch,pitch);
 const stop=keyboardInput(new Set(['KeyA','KeyD','ArrowRight','ArrowLeft']));assert.equal(stop.turn,0);assert.equal(stop.mx,0);
});
test('spoken heading normalizes a full turn and distinguishes elevation',()=>{
 assert.match(headingText({yaw:Math.PI/2,pitch:0}),/東、90度。水平/);
 assert.match(headingText({yaw:-Math.PI/2,pitch:-Math.PI/6}),/西、270度。下30度/);
 assert.match(headingText({yaw:2*Math.PI,pitch:Math.PI/6}),/北、0度。上30度/);
});
test('NPC creation is removed, including legacy practice arguments',()=>{
 const p=makePlayer(newProfile('a'));const g=createMatch([p],{practice:true,difficulty:3});assert.equal(g.players.length,1);assert.equal(g.practice,false);tick(g,.05);assert.equal(g.players.length,1);
});
test('friend codes accept pasted invitation links, spacing, lowercase and fullwidth',()=>{
 assert.equal(friendCode('https://fieldlink-arena-yuuki.onrender.com/?friend=abcdef0123'),'ABCDEF0123');
 assert.equal(friendCode(' ａｂｃｄｅ ｆ０１２３ '),'ABCDEF0123');assert.equal(friendCode('ABCDE-F0123'),'ABCDEF0123');
 assert.equal(friendCode('12345678'),null);assert.match(friendCodeError('12345678'),/ルーム/);
 assert.equal(friendCode('https://fieldlink-arena-yuuki.onrender.com/?room=12345678'),null);assert.equal(friendCode('invalid'),null);
});
