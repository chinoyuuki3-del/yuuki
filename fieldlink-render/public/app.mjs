import {roomCode,roomIntent,roomCodeError} from './rooms.mjs';
import {friendCode,friendCodeError} from './friends.mjs';
import {keyboardInput,headingText} from './controls.mjs';
import {locationAccess} from './location.mjs';
import {WEAPONS,GOODS,clamp,distance} from './engine.mjs';
const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const icons={play:'<path d="m8 4 12 8-12 8z"/>',keyboard:'<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M6 9h1m3 0h1m3 0h1m3 0h1M6 13h1m3 0h1m3 0h1m3 0h1M7 16h10"/>',compass:'<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6z"/>',leaf:'<path d="M20 3C6 2 2 9 5 16c6 7 15 0 15-13Z M4 21 15 9"/>',crosshair:'<circle cx="12" cy="12" r="7"/><path d="M12 1v6m0 10v6M1 12h6m10 0h6"/>',volume:'<path d="m11 4-6 5H2v6h3l6 5zM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',bluetooth:'<path d="m7 6 11 12-6 4V2l6 5L7 18"/>'};
for(const el of $$('[data-icon]'))el.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true">'+icons[el.dataset.icon]+'</svg>';
const store={get(k,fb){try{return localStorage.getItem(k)??fb;}catch{return fb;}},set(k,v){try{localStorage.setItem(k,v);}catch{}}};
const app={profile:null,ws:null,connected:false,retry:0,room:null,state:null,control:'physical',low:store.get('fl-low','0')==='1',sound:store.get('fl-sound','1')==='1',view:'iso',keys:new Set(),physical:null,orientation:null,calibration:null,geoWatch:null,lastGeo:null,eventId:0,shownResult:false,noticeUntil:0,latency:null,pendingAction:null,page:'field',roomPreview:null,joining:false,roomBusy:false,shopFilter:'all'};
let toastTimer,noticeTimer;
function toast(msg){$('#toast').textContent=msg;$('#toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('show'),3800);}
function info(title,text){$('#infoTitle').textContent=title;$('#infoText').textContent=text;$('#infoDialog').showModal();}
function transmit(data){if(app.ws?.readyState===WebSocket.OPEN){app.ws.send(JSON.stringify(data));return true;}toast('サーバーに接続中です。少し待ってね。');return false;}
function connect(){
  if(app.ws&&app.ws.readyState<2)return;
  const ws=new WebSocket((location.protocol==='https:'?'wss://':'ws://')+location.host+'/ws');app.ws=ws;
  ws.onopen=()=>{app.retry=0;ws.send(JSON.stringify({type:'hello',save:store.get('fl-save',''),name:store.get('fl-name','プレイヤー')}));};
  ws.onmessage=e=>{let m;try{m=JSON.parse(e.data);}catch{return;}
    if(m.type==='profile'){const first=!app.profile;app.connected=true;app.profile=m.profile;store.set('fl-save',m.save);store.set('fl-name',m.profile.name);$('#connectionText').textContent='サーバー接続済み';$('#connectionDot').classList.remove('pending');renderProfile();if(first)handleInvite();updateStart();}
    if(m.type==='session'&&!m.room&&app.room){endUI();toast('サーバーの再接続が完了しました。新しい対戦を始められます');}
    if(m.type==='room'){app.joining=false;app.roomBusy=false;roomStatus('ルームに接続しました');roomUpdate(m.room);updateStart();}
    if(m.type==='roomPreview'){app.roomBusy=false;if(roomCode($('#roomCode').value)===m.room.code){app.roomPreview=m.room;setControl(m.room.control);roomStatus(m.room.hostName+'さんのルームを確認しました。');if(app.joining){if(app.control==='keyboard'||(app.physical&&app.orientation))joinRoom();else roomStatus('相手と同じ本体操作に設定しました。位置情報と向きを許可してから「このルームに参加」を押してね。');}}updateStart();}
    if(m.type==='error'&&['roomLookup','join','create'].includes(m.context)){app.roomBusy=false;app.joining=false;roomStatus(m.message);updateStart();}
    if(m.type==='state'){app.state=m.state;roomUpdate(m.room);updateBattle();}
    if(m.type==='friendStatus'){friendStatus(m.message);toast(m.message);}
    if(m.type==='error'&&['friendRequest','friendAccept'].includes(m.context)){friendStatus(m.message);$$('#friendRequests button').forEach(b=>b.disabled=false);}
    if(m.type==='error'||m.type==='notice'){toast(m.message);if(app.room)speak(m.message);}
    if(m.type==='actionApplied'){const self=app.state?.players.find(p=>p.id===app.profile?.id);if(self){self.weapon=m.weapon;self.z=m.height;}if(app.profile)app.profile.ammo=m.ammo;renderProfile();if(m.action==='weapon')speak(WEAPONS[m.weapon].name+'を装備');}
    if(m.type==='left'){endUI();if(m.message)toast(m.message);}
    if(m.type==='friendRequest')friendRequest(m.from);
    if(m.type==='pong'){app.latency=Date.now()-m.time;$('#connectionText').textContent='接続済み · '+app.latency+'ms';}
  };
  ws.onclose=e=>{app.connected=false;app.roomBusy=false;app.joining=false;$('#connectionDot').classList.add('pending');$('#connectionText').textContent='再接続しています';app.keys.clear();updateStart();if(app.room){$('#centerMessage').hidden=false;$('#centerMessage').textContent='再接続中…';$('#centerMessage').disabled=true;}
    if(e.code===4002){$('#connectionText').textContent='別の画面で接続中';info('別の画面で接続しました','同じブラウザーの複数の画面では同時にプレイできません。この画面を使う場合は再読み込みしてください。');return;}
    setTimeout(connect,Math.min(15000,1000*2**app.retry++));
  };ws.onerror=()=>{};
}
function page(name){if(app.room){toast('対戦・待機を終了してからメニューを開いてね');return;}app.page=name;$$('.page').forEach(x=>x.classList.toggle('active',x.id===name+'Page'));$$('.nav').forEach(x=>x.classList.toggle('active',x.dataset.page===name));window.scrollTo(0,0);}
$$('[data-page]').forEach(b=>b.onclick=()=>page(b.dataset.page));$$('[data-go]').forEach(b=>b.onclick=()=>page(b.dataset.go));$('#wallet').onclick=()=>page('shop');
$$('[data-close]').forEach(b=>b.onclick=()=>$('#'+b.dataset.close).close());
$('#profileButton').onclick=()=>{if(app.room){toast('名前はロビーで変更できます');return;}$('#nameInput').value=app.profile?.name||'';$('#nameDialog').showModal();};$('#saveName').onclick=()=>{transmit({type:'name',name:$('#nameInput').value});$('#nameDialog').close();};
const arts={
 pistol:'<path d="M13 20h56v12H47l-3 19H29l2-19H15z"/><path d="M68 22h13v7H68zM38 33h12v11H38z" fill="none" stroke="currentColor" stroke-width="3"/><path d="M19 16h44v5H19z" opacity=".55"/>',
 rifle:'<path d="M7 26h16l10-8h43v15H49l-4 18H34l3-18H20L8 40zM76 23h28v7H76zM100 21h8v11h-8z"/><path d="M48 12h23v6H48zM58 34h17l-3 16H59z" opacity=".6"/>',
 rail:'<path d="M6 29h21l13-10h40v15H48l-6 16H29l4-17H16L6 41zM79 23h32v5H79z"/><path d="M46 8h24v8H46zM49 16h4v4h-4zM63 16h4v4h-4zM82 20h5v12h-5z" opacity=".65"/>'
};
function weaponArt(k){return '<div class="weapon-art"><svg viewBox="0 0 120 60" aria-hidden="true">'+(arts[k]||arts[WEAPONS[k]?.art]||arts.rifle)+'</svg></div>';}
function renderProfile(){const p=app.profile;if(!p)return;$('#coins').textContent=p.coins.toLocaleString();$('#profileButton').textContent=p.name.slice(0,1);$('#profileButton').title=p.name;$('#friendCode').textContent=p.id;
  if($('#friendQR').dataset.code!==p.id){$('#friendQR').src='/qr.svg?kind=friend&code='+p.id;$('#friendQR').dataset.code=p.id;}
  const self=app.state?.players.find(p=>p.id===app.profile.id);const selected=self?.weapon||'pistol';
  $('#loadout').innerHTML=Object.entries(WEAPONS).map(([k,w],i)=>{const owned=p.owned.includes(k);return '<button class="loadout-card '+(selected===k?'equipped ':'')+(!owned?'locked':'')+'" data-weapon="'+k+'" aria-label="'+w.name+(owned?'を装備':'をショップで見る')+'"><span class="key-tag">'+(i+1)+'</span>'+weaponArt(k)+'<div><div class="weapon-tag">'+w.tag+'</div><h3>'+w.name+'</h3><small>'+(owned?(selected===k?'装備中':'装備する'):'ショップで解放')+'</small></div><div class="ammo">'+(k==='pistol'?'∞':owned?p.ammo[k]:'—')+'<small>AMMO</small></div></button>';}).join('');
  $$('[data-weapon]').forEach(b=>b.onclick=()=>{const k=b.dataset.weapon;if(!p.owned.includes(k)){if(app.room)toast('銃は対戦前にショップで買えます');else page('shop');return;}if(app.room)transmit({type:'action',action:'weapon',value:k});else toast('対戦中に数字キー '+(Object.keys(WEAPONS).indexOf(k)+1)+' または装備カードで切り替えられます');});
  if($('#resultDialog').open)$('#resultCoins').textContent=p.coins;
  renderShop();renderFriends();for(const row of $$('#friendRequests [data-from]'))if(p.friends.some(f=>f.id===row.dataset.from))row.remove();
  const battle=$('#battleWeapons');if(battle.dataset.owned!==p.owned.join(',')||battle.dataset.weapon!==selected){battle.dataset.owned=p.owned.join(',');battle.dataset.weapon=selected;battle.replaceChildren();for(const k of p.owned){const b=document.createElement('button');b.textContent=WEAPONS[k].name;b.disabled=!!app.room&&app.room.status!=='playing';b.className=selected===k?'selected':'';b.onclick=()=>transmit({type:'action',action:'weapon',value:k});battle.append(b);}}
}
function renderShop(){
 if(!app.profile)return;const p=app.profile;
 const goods=Object.entries(GOODS).filter(([,g])=>app.shopFilter==='all'||g.category===app.shopFilter);
 $('#shopCount').textContent='全'+Object.keys(GOODS).length+'商品 / 表示 '+goods.length+'商品';
 $('#shopGrid').innerHTML=goods.map(([k,g])=>{
  const w=WEAPONS[k],owned=!!w&&p.owned.includes(k);
  const stats=w?[w.damage+' ダメージ','射程 '+w.range+'m']:g.ammoMultiplier?['弾薬補充','まとめて全購入銃']:['所持 '+p[g.item]+'個',g.quantity+'個入り'];
  const detail=g.ammoMultiplier?g.description+' '+Object.entries(WEAPONS).filter(([k])=>k!=='pistol').map(([,w])=>w.name+' '+w.refill*g.ammoMultiplier+'発').join(' / '):g.description;
  return '<article class="shop-card"><div class="shop-art"><span class="mini-label">FIELD EQUIPMENT / '+k.toUpperCase()+'</span>'+(w?weaponArt(k):'<span class="item-art">'+({ammo:'▥',ammoLarge:'▥',revive:'⛨',revivePack:'⛨',medkit:'✚',shield:'◇',grenade:'◈',grenadePack:'◈',premium:'⊙',premiumPack:'⊙'})[k]+'</span>')+'</div><div class="shop-details"><h2>'+g.label+'</h2><p>'+detail+'</p><div class="stat-pills"><span>'+stats[0]+'</span><span>'+stats[1]+'</span></div><button class="buy-button" data-buy="'+k+'" '+(owned?'disabled':'')+'><span>'+(owned?'購入済み':'購入する')+'</span><b>C '+g.price+'</b></button></div></article>';
 }).join('');
 $$('[data-buy]').forEach(b=>b.onclick=()=>transmit({type:'buy',item:b.dataset.buy}));
}
$$('[data-shop-filter]').forEach(b=>b.onclick=()=>{app.shopFilter=b.dataset.shopFilter;$$('[data-shop-filter]').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b));});renderShop();});
function renderFriends(){const list=$('#friendList');list.replaceChildren();$('#friendCount').textContent=app.profile.friends.length;if(!app.profile.friends.length){const p=document.createElement('p');p.className='tiny';p.textContent='最初の友達を追加しよう。';list.append(p);}for(const f of app.profile.friends){const row=document.createElement('div'),a=document.createElement('span'),text=document.createElement('div'),name=document.createElement('strong'),id=document.createElement('small');a.className='avatar';a.textContent=f.name.slice(0,1);name.textContent=f.name;id.textContent=f.id;text.append(name,id);row.append(a,text);list.append(row);}}
function friendStatus(message){$('#friendStatus').textContent=message;}
function friendRequest(from){
 if(app.profile?.friends.some(f=>f.id===from.id)||$$('#friendRequests [data-from]').some(row=>row.dataset.from===from.id))return;
 const row=document.createElement('div');row.className='request';row.dataset.from=from.id;
 const label=document.createElement('span');label.textContent=from.name+' さんから友達申請';
 const yes=document.createElement('button');yes.className='secondary';yes.textContent='追加する';yes.onclick=()=>{if(transmit({type:'friendAccept',from:from.id})){yes.disabled=true;friendStatus('友達に追加しています…');}};
 const later=document.createElement('button');later.className='text-button';later.textContent='あとで';later.onclick=()=>row.remove();
 row.append(label,yes,later);$('#friendRequests').append(row);
 if(!app.room)page('friends');
 friendStatus('友達申請が届きました。「追加する」でお互いのリストに登録されます。');
 toast(from.name+' さんから申請が届いたよ。フレンド画面で確認してね。');
}
$('#addFriend').onclick=()=>{const value=$('#friendInput').value,code=friendCode(value);if(!code){friendStatus(friendCodeError(value));return;}if(!app.connected){friendStatus('サーバーに接続中です。接続が終わってからもう一度押してね。');return;}if(transmit({type:'friendRequest',code}))friendStatus('申請を送っています…');};
$('#friendInput').addEventListener('keydown',e=>{if(e.key==='Enter')$('#addFriend').click();});
$('#copyFriend').onclick=async()=>{if(!app.profile)return;const link=location.origin+'/?friend='+app.profile.id;try{await navigator.clipboard.writeText(link);toast('招待リンクをコピーしました');}catch{info('友達コード',app.profile.id+' を友達に伝えてね。');}};
$('#bluetoothInfo').onclick=()=>info('Bluetoothはアプリ対応が必要です','ブラウザーは、他のスマホへ自分をBluetoothの友達として知らせる機能を共通で提供していません。ウェブ版ではQRコードを使って、お互いが確認して友達になります。Bluetoothの自動発見と近接スタートは未実装です。');
function handleInvite(){const q=new URLSearchParams(location.search);if(q.has('friend')){page('friends');$('#friendInput').value=q.get('friend').slice(0,10);friendStatus('招待コードを読み取りました。「友達に申請」を押してね。');}if(q.has('room')){$('#roomCode').value=q.get('room').slice(0,2048);page('field');roomStatus('招待コードを読み取りました。「このルームに参加」を押してね。');updateStart();}if(q.has('friend')||q.has('room'))history.replaceState({},'',location.pathname);}
function roomStatus(text){$('#roomStatus').textContent=text;}
function updateStart(){
 const joining=roomIntent($('#roomCode').value)==='join';
 const lookup=joining&&app.roomPreview?.code!==roomCode($('#roomCode').value);
 const needsLocation=app.control==='physical'&&!app.physical;
 const needsDirection=app.control==='physical'&&!app.orientation;
 const locating=['requesting','waiting'].includes(app.locationPhase);
 $('#joinRoom').disabled=!app.connected||app.roomBusy;
 $('#startButton').disabled=app.roomBusy||(!lookup&&locating)||((joining||(!needsLocation&&!needsDirection))&&!app.connected);
 $('#startLabel').textContent=app.roomBusy?'ルームに接続しています…':joining?(lookup?'このルームに参加':locating?'端末の許可・位置取得を待っています':needsLocation?'位置情報を許可して参加へ':needsDirection?'本体の向きを許可して参加へ':'このルームに参加'):locating?'端末の許可・位置取得を待っています':needsLocation?'① 位置情報を許可する':needsDirection?'② 本体の向きを許可する':!app.connected?'接続を待っています':'新しいルームを作る';
 $('#setupNote').textContent=joining?'入力したコードのルームに参加します。新しいルームは作りません。':'友達のコードがある場合は上の入力欄に貼ってね。';
}
$('#roomCode').addEventListener('input',()=>{app.roomPreview=null;app.joining=false;app.roomBusy=false;roomStatus('コードを入力したら「このルームに参加」を押してね。');updateStart();});
$('#roomCode').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();joinRoom();}});
$('#clearRoomCode').onclick=()=>{$('#roomCode').value='';app.roomPreview=null;app.joining=false;app.roomBusy=false;roomStatus('コードを消しました。新しいルームを作れます。');updateStart();};

function setControl(v){app.control=v;$('#keyboardMode').classList.toggle('selected',v==='keyboard');$('#physicalMode').classList.toggle('selected',v==='physical');$('#sensorSetup').hidden=v!=='physical';$('#keyboardSetup').hidden=v!=='keyboard';updateStart();}
$('#keyboardMode').onclick=()=>setControl('keyboard');$('#physicalMode').onclick=()=>setControl('physical');
$('#lowPower').checked=app.low;$('#lowPower').onchange=e=>{app.low=e.target.checked;store.set('fl-low',app.low?'1':'0');toast(app.low?'省エネON。爆発物とジャンプは使えません':'通常モードにしました');};
const locationHelp=$('#locationHelp');
const locationControl=locationAccess({nav:navigator,secure:window.isSecureContext,
 onState(s){
  app.locationPhase=s.phase;app.physical=s.position;
  const pending=['requesting','waiting'].includes(s.phase);
  $('#locationButton').disabled=pending;
  $('#locationButton').textContent=pending?'許可・位置取得を待っています…':s.phase==='ready'?'位置情報を取り直す':'① 位置情報を許可する';
  const messages={idle:s.permission==='granted'?'位置情報は許可済みです。ボタンを押すと取得します。':'ボタンを押して、端末の確認画面で「許可」を選んでね。',requesting:s.permission==='granted'?'許可済みです。現在地を取得しています…':'端末の確認画面で「許可」を選んでね。許可済みなら、そのまま現在地を取得します。',waiting:'許可画面が見つからない・進まない場合は、下の案内を確認してね。',denied:'位置情報がブロックされています。下の手順で許可を変更してね。',timeout:'位置の取得に時間がかかっています。端末の位置情報を確認して、もう一度押してね。',unavailable:'現在地を取得できません。端末の位置情報がオンか確認してね。',unsupported:'このブラウザーでは位置情報を使えません。SafariやChromeで開いてね。',insecure:'位置情報にはHTTPSが必要です。下のリンクから開いてね。'};
  $('#locationStatus').textContent=s.phase==='ready'?'許可済み · 位置の準備OK':messages[s.phase];
  if(['waiting','denied','timeout','unavailable','unsupported','insecure'].includes(s.phase))locationHelp.open=true;
  updateStart();
 },onPosition(p){if(app.room?.control==='physical')transmit({type:'location',location:p});}
});
$('#locationButton').onclick=()=>locationControl.request();
$('#retryLocation').onclick=()=>locationControl.request();
$('#copyGameLink').onclick=async()=>{try{await navigator.clipboard.writeText('https://fieldlink-arena-yuuki.onrender.com/');toast('URLをコピーしました。SafariやChromeのアドレス欄に貼り付けてね');}catch{info('ブラウザーで開くURL','https://fieldlink-arena-yuuki.onrender.com/');}};
locationControl.inspect();
let lastRaw=null;
function orientation(e){if(e.alpha===null||e.beta===null||e.gamma===null)return;const compass=typeof e.webkitCompassHeading==='number';if(!compass&&!e.absolute){if(!app.orientation)$('#orientationStatus').textContent='地磁気による方角を取得できません。PCキー操作テストを利用できます';return;}const alpha=compass?360-e.webkitCompassHeading:e.alpha;const a=alpha*Math.PI/180,b=e.beta*Math.PI/180,c=e.gamma*Math.PI/180;const x=-(Math.cos(a)*Math.sin(c)+Math.sin(a)*Math.sin(b)*Math.cos(c)),y=-(Math.sin(a)*Math.sin(c)-Math.cos(a)*Math.sin(b)*Math.cos(c)),z=-Math.cos(b)*Math.cos(c);lastRaw={yaw:Math.atan2(x,y),pitch:Math.asin(clamp(z,-1,1))};if(!app.calibration)app.calibration={...lastRaw};app.orientation={yaw:lastRaw.yaw,pitch:clamp(lastRaw.pitch-app.calibration.pitch,-1.35,1.35)};$('#orientationStatus').textContent='方角センサーOK · 構えの上下を調整できます';updateStart();}
$('#orientationButton').onclick=async()=>{if(!('DeviceOrientationEvent'in window)){toast('方向センサーがありません。キー・タッチ操作を使ってね');return;}try{if(typeof DeviceOrientationEvent.requestPermission==='function'){const r=await DeviceOrientationEvent.requestPermission();if(r!=='granted')throw Error('方向センサーが許可されませんでした');}if(lastRaw){app.calibration={...lastRaw};toast('構えの上下を調整しました。左右の向きは方角センサーを使います');}window.removeEventListener('deviceorientation',orientation);window.addEventListener('deviceorientation',orientation);window.removeEventListener('deviceorientationabsolute',orientation);window.addEventListener('deviceorientationabsolute',orientation);$('#orientationStatus').textContent='本体を構えてください。センサーを待っています…';setTimeout(()=>{if(!app.orientation)$('#orientationStatus').textContent='センサーの値を受け取れません。PCキー操作テストを選んでね';},4000);}catch(e){toast(e.message);}};
function preparePhysical(){if(app.control!=='physical')return true;if(!app.physical){locationControl.request();return false;}if(!app.orientation){$('#orientationButton').click();return false;}return true;}
function resetMatch(){unlockAudio();app.eventId=0;lastEffect=0;app.shownResult=false;app.state=null;}
function joinRoom(){
 const value=$('#roomCode').value,code=roomCode(value);if(!code){roomStatus(roomCodeError(value));return;}
 if(!app.connected){roomStatus('サーバー接続を待ってから、もう一度参加してね。');return;}
 if(app.roomBusy)return;
 app.joining=true;
 if(app.roomPreview?.code!==code){app.roomBusy=true;roomStatus('相手のルームを確認しています…');transmit({type:'roomLookup',code});updateStart();return;}
 setControl(app.roomPreview.control);
 if(!preparePhysical()){roomStatus('位置情報と向きの準備ができたら、もう一度参加を押してね。');return;}
 resetMatch();app.roomBusy=true;roomStatus('入力したルームに参加しています…');transmit({type:'join',code,control:app.control,location:app.physical,low:app.low});updateStart();
}
function begin(){if(roomIntent($('#roomCode').value)==='join'){joinRoom();return;}if(!preparePhysical())return;if(!app.connected){toast('サーバーへの接続を待ってね');return;}if(app.roomBusy)return;resetMatch();app.roomBusy=true;transmit({type:'create',control:app.control,low:app.low,location:app.physical});updateStart();}
$('#startButton').onclick=begin;$('#joinRoom').onclick=joinRoom;
$('#copyRoomLink').onclick=async()=>{if(!app.room)return;const link=location.origin+'/?room='+app.room.code;try{await navigator.clipboard.writeText(link);toast('ルームの招待リンクをコピーしました');}catch{info('ルームの招待リンク',link);}};
$('#readyButton').onclick=()=>transmit({type:'ready'});$('#cancelRoom').onclick=()=>transmit({type:'leave'});$('#leaveButton').onclick=()=>transmit({type:'leave'});
function roomUpdate(r){const old=app.room;app.room=r;$$('#touchControls button').forEach(b=>b.disabled=r.status!=='playing');if(r.status==='waiting'){if(!$('#roomDialog').open)$('#roomDialog').showModal();$('#roomDisplay').textContent=r.code;if($('#roomQR').dataset.code!==r.code){$('#roomQR').src='/qr.svg?code='+r.code;$('#roomQR').dataset.code=r.code;}$('#roomPlayers').replaceChildren();for(const p of r.players){const row=document.createElement('div'),name=document.createElement('b'),status=document.createElement('span');name.textContent=p.name;status.textContent=p.ready?'準備OK':'準備中';row.append(name,status);$('#roomPlayers').append(row);}const self=r.players.find(p=>p.id===app.profile.id);$('#readyButton').textContent=self?.ready?'準備OKを取り消す':'準備OK！';return;}
  $('#roomDialog').close();document.body.classList.add('playing');document.body.classList.toggle('physical',r.control==='physical');document.body.classList.toggle('low',app.low);$('#lobbyOverlay').hidden=true;$('#battleHud').hidden=false;$('#touchControls').hidden=false;$('#arenaLabel').textContent='FRIEND MATCH';$('#arenaSub').textContent='ルーム '+r.code;$('#headingButton').hidden=r.control!=='keyboard';$('#recalibrateButton').hidden=r.control!=='physical';
  if(r.status==='countdown'){$('#centerMessage').hidden=true;if(old?.remaining!==r.remaining){speak(String(r.remaining));beep(400,.08);}}
  else if(r.status==='paused'){$('#centerMessage').hidden=false;$('#centerMessage').disabled=true;$('#centerMessage').textContent='相手の再接続を待っています';}
  else {$('#centerMessage').hidden=true;if(old?.status==='countdown'&&r.status==='playing')speak('スタート！');}
}
function endUI(){if(app.room)$('#roomCode').value='';app.room=null;app.roomBusy=false;app.joining=false;app.roomPreview=null;app.state=null;app.keys.clear();app.eventId=0;app.shownResult=false;document.body.classList.remove('playing','physical','low');$('#roomDialog').close();$('#resultDialog').close();$('#lobbyOverlay').hidden=false;$('#battleHud').hidden=true;$('#touchControls').hidden=true;$('#centerMessage').hidden=true;$('#arenaLabel').textContent='REAL WORLD BATTLE';$('#arenaSub').textContent='画面の外が、プレイフィールド。';renderProfile();updateStart();}
function updateBattle(){if(!app.state||!app.profile)return;const g=app.state,p=g.players.find(x=>x.id===app.profile.id);if(!p)return;
  for(const effect of g.effects){if(effect.id>lastEffect&&effect.type==='shot'&&effect.owner===p.id){beep(260,.05);vibrate(20);}lastEffect=Math.max(lastEffect,effect.id);}
  for(const e of g.events){if(e.id<=app.eventId)continue;app.eventId=e.id;notice(e.text);if(e.kind==='damage'){vibrate([90,50,90]);beep(120,.12);if(p.hp<=30)speak('HPが少ないです。'+p.hp);} if(e.kind==='hit')beep(900,.05);if(e.kind==='kill'){beep(1000,.12);speak(e.text);}if(['revive','pickup','empty','item'].includes(e.kind)){speak(e.text);beep(e.kind==='empty'?180:650,.12);}}
  if(g.status==='ended'&&!app.shownResult){app.shownResult=true;app.keys.clear();const won=g.result.winner===p.id;$('#resultTitle').textContent=won?'ナイスバトル！':'もう一度、挑戦しよう。';$('#resultReason').textContent=g.result.reason+(won?' / 勝利ボーナス +150':' / 参加ボーナス +30');$('#resultKills').textContent=p.score;$('#resultCoins').textContent=app.profile.coins;$('#resultDialog').showModal();speak(won?'勝利！ナイスバトル！':'対戦終了！');}
}
function notice(msg){$('#battleNotice').textContent=msg;$('#battleNotice').classList.add('visible');clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('#battleNotice').classList.remove('visible'),2000);}
$('#backButton').onclick=()=>transmit({type:'leave'});$('#retryButton').onclick=()=>{transmit({type:'leave'});toast('新しいルームを作って再戦しよう！');};
let lastEffect=0;

$('#statusButton').onclick=()=>{const p=app.state?.players.find(p=>p.id===app.profile?.id);if(!p)return;app.sound=true;soundUI();unlockAudio();speak('HP '+p.hp+'。高さ '+p.z+'。'+WEAPONS[p.weapon].name+'、弾は'+(p.weapon==='pistol'?'無限':app.profile.ammo[p.weapon])+'。ボム '+app.profile.grenade+'。復活 '+app.profile.revive+'。回復キット '+app.profile.medkit+'。ポケットシールド '+app.profile.shield);};
$('#headingButton').onclick=()=>{const p=app.state?.players.find(p=>p.id===app.profile?.id);if(!p)return;app.sound=true;soundUI();unlockAudio();speak(headingText(p));};
$('#recalibrateButton').onclick=()=>{if(lastRaw){app.calibration={...lastRaw};speak('構えを調整しました');}else speak('方角センサーが有効ではありません');};
let audio=null;
function unlockAudio(){try{if(!audio)audio=new(window.AudioContext||window.webkitAudioContext)();audio.resume();}catch{}}
function beep(freq,length){if(!app.sound||!audio)return;const osc=audio.createOscillator(),gain=audio.createGain();osc.type='sine';osc.frequency.value=freq;gain.gain.setValueAtTime(.07,audio.currentTime);gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+length);osc.connect(gain).connect(audio.destination);osc.start();osc.stop(audio.currentTime+length);}
function speak(text){if(!app.sound||!('speechSynthesis'in window))return;if(speechSynthesis.pending)return;const u=new SpeechSynthesisUtterance(text);u.lang='ja-JP';u.rate=1.15;speechSynthesis.speak(u);}
function vibrate(p){if('vibrate'in navigator)navigator.vibrate(p);}
function soundUI(){$('#soundLabel').textContent='音声 '+(app.sound?'ON':'OFF');}soundUI();$('#soundButton').onclick=()=>{app.sound=!app.sound;store.set('fl-sound',app.sound?'1':'0');unlockAudio();soundUI();if(app.sound){speak('音声案内をオンにしました');}else if('speechSynthesis'in window)speechSynthesis.cancel();};
$('#fireSize').value=store.get('fl-fire-size','112');document.documentElement.style.setProperty('--fire-size',$('#fireSize').value+'px');$('#fireSize').oninput=e=>{store.set('fl-fire-size',e.target.value);document.documentElement.style.setProperty('--fire-size',e.target.value+'px');};$('#bothFire').checked=store.get('fl-both-fire','0')==='1';document.body.classList.toggle('show-left-fire',$('#bothFire').checked);$('#bothFire').onchange=e=>{store.set('fl-both-fire',e.target.checked?'1':'0');document.body.classList.toggle('show-left-fire',e.target.checked);};
const actions={KeyJ:'jump',KeyK:'down',KeyM:'mine',KeyB:'grenade',KeyN:'premium',KeyH:'medkit',KeyG:'shield'};
window.addEventListener('keydown',e=>{if(!app.room||$('dialog[open]')||['INPUT','TEXTAREA'].includes(e.target.tagName))return;const k=e.code;if(['Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','KeyW','KeyA','KeyS','KeyD','KeyR',...Object.keys(actions),'Digit1','Digit2','Digit3','Digit4','Digit5','Digit6'].includes(k))e.preventDefault();app.keys.add(k);if(e.repeat)return;if(k==='KeyR'&&app.room.control==='keyboard')$('#headingButton').click();if(k==='Space')transmit({type:'action',action:'fire'});if(actions[k])transmit({type:'action',action:actions[k]});if(/^Digit[1-6]$/.test(k))transmit({type:'action',action:'weapon',value:Object.keys(WEAPONS)[Number(k.slice(-1))-1]});});
window.addEventListener('keyup',e=>app.keys.delete(e.code));window.addEventListener('blur',()=>app.keys.clear());document.addEventListener('visibilitychange',()=>app.keys.clear());
$$('[data-hold]').forEach(b=>{const up=()=>{app.keys.delete(b.dataset.hold);b.classList.remove('held');};b.onpointerdown=e=>{e.preventDefault();unlockAudio();b.setPointerCapture(e.pointerId);app.keys.add(b.dataset.hold);b.classList.add('held');if(b.dataset.hold==='Space')transmit({type:'action',action:'fire'});};b.onpointerup=up;b.onpointercancel=up;b.onlostpointercapture=up;b.onclick=e=>{if(e.detail===0&&b.dataset.hold==='Space')transmit({type:'action',action:'fire'});};});
$$('[data-action]').forEach(b=>b.onclick=()=>transmit({type:'action',action:b.dataset.action}));
let nextInput=0;setInterval(()=>{if(!app.connected||!app.room||app.room.status!=='playing')return;const now=performance.now();if(now<nextInput)return;nextInput=now+(app.low?200:65);const input=keyboardInput(app.keys);if(app.room.control==='physical'&&app.orientation)Object.assign(input,app.orientation);transmit(input);},30);
setInterval(()=>{if(app.connected)transmit({type:'ping',time:Date.now()});},15000);
let lastGuide=0;setInterval(()=>{const g=app.state,p=g?.players.find(x=>x.id===app.profile?.id);if(!p||g.status!=='playing'||!p.alive||document.hidden)return;let nearest=null,d=Infinity;for(const item of g.items){const n=distance(p,item);if(n<d){d=n;nearest=item;}}if(nearest&&d<5){vibrate(d<1.7?[75,35,75]:d<3?[50]:[20]);if(Date.now()-lastGuide>4500){const angle=Math.atan2(nearest.x-p.x,nearest.y-p.y)-p.yaw;const a=Math.atan2(Math.sin(angle),Math.cos(angle));const text=d<1.7?'アイテム、すぐそばです':Math.abs(a)<.5?'アイテム、前です':Math.abs(a)>2.5?'アイテム、後ろです':a>0?'アイテム、右です':'アイテム、左です';speak(text);lastGuide=Date.now();}}},700);

setControl('physical');updateStart();connect();
