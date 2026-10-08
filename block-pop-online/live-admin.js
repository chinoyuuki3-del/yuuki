'use strict';
/**
 * Block Pop! ONLINE: admin-controlled live catalogue and player gifts.
 * Administrative secrets come only from Render environment variables.
 * Local /tmp state is non-durable on Render's ephemeral filesystem.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');

module.exports = function createLiveAdmin({catalog, legacyIds}) {
  const original = new Map(catalog.items.map(x => [x.id, x]));
  const allowedLegacy = new Set(legacyIds);
  const statePath = process.env.BLOCKPOP_STATE_FILE || '/tmp/blockpop-live-state.json';
  const adminHash = process.env.BLOCKPOP_ADMIN_CODE_SHA256 || '';
  const signingKey = process.env.BLOCKPOP_ADMIN_SESSION_SECRET || '';
  const adminReady = /^[0-9a-f]{64}$/i.test(adminHash) && signingKey.length >= 48;
  const freshState = () => ({revision:1, overrides:{}, gifts:[{
    id:'welcome-live-1', title:'🎉 ライブショップ記念プレゼント',
    description:'みんなにコイン50枚とハンマー1個をプレゼント！',
    coins:50, itemId:'hammer', qty:1, enabled:true, createdAt:Date.now(), claims:{}
  }]});
  let state = freshState();
  try {
    if(fs.existsSync(statePath) && fs.statSync(statePath).size < 6*1024*1024) {
      const saved=JSON.parse(fs.readFileSync(statePath,'utf8'));
      if(saved && Number.isInteger(saved.revision) && saved.overrides &&
        typeof saved.overrides==='object' && Array.isArray(saved.gifts)) state=saved;
    }
  } catch(e) { console.warn('Live shop state fallback:',e.message); }
  const LOGIN_LIMIT=new Map(), CLAIM_LIMIT=new Map();
  const hash=s=>crypto.createHash('sha256').update(s).digest('hex');
  const safeText=(v,n=60)=>typeof v==='string'?v.trim().slice(0,n):'';
  const safeLabel=(v)=>safeText(v,18).replace(/[<>"'`\\\r\n]/g,'');
  const validId=id=>typeof id==='string' && /^[A-Za-z0-9_-]{1,48}$/.test(id);
  const status=(res,code,obj)=>{
    const body=Buffer.from(JSON.stringify(obj),'utf8');
    res.writeHead(code,{'Content-Type':'application/json; charset=utf-8','Content-Length':body.length,'Cache-Control':'no-store'});
    res.end(body);
  };
  function cors(req,res){
    const origin=req.headers.origin;
    const trusted=!origin || origin==='null' || origin==='https://block-pop-online.onrender.com' ||
      origin==='http://localhost:3000' || origin==='http://127.0.0.1:3000';
    if(!trusted)return false;
    res.setHeader('Access-Control-Allow-Origin',origin||'*');
    res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
    res.setHeader('Vary','Origin, Accept-Encoding');
    return true;
  }
  function persist(){
    const text=JSON.stringify(state);
    if(Buffer.byteLength(text)>5*1024*1024)throw Error('Gift data capacity reached');
    const tmp=statePath+'.'+process.pid+'.tmp';
    fs.mkdirSync(path.dirname(statePath),{recursive:true});
    fs.writeFileSync(tmp,text,{mode:0o600});
    fs.renameSync(tmp,statePath);
  }
  function limit(bucket,req,max,windowMs){
    // Avoid grouping all players behind the same Render proxy address.
    const forwarded=String(req.headers['x-forwarded-for']||'').split(',')[0].trim().slice(0,100);
    const ip=/^[0-9a-fA-F.:]{3,100}$/.test(forwarded)?forwarded:(req.socket.remoteAddress||'unknown').slice(0,100);
    const now=Date.now(),entry=bucket.get(ip);
    if(!entry||entry.until<now){bucket.set(ip,{n:1,until:now+windowMs});return true;}
    entry.n++;return entry.n<=max;
  }
  const tokenSignature=p=>crypto.createHmac('sha256',signingKey).update(p).digest('base64url');
  function issueToken(){
    const payload=Buffer.from(JSON.stringify({exp:Date.now()+3600000,n:crypto.randomBytes(16).toString('hex')})).toString('base64url');
    return payload+'.'+tokenSignature(payload);
  }
  function authenticated(req){
    if(!adminReady)return false;
    const authorization=req.headers.authorization||'';
    if(!authorization.startsWith('Bearer '))return false;
    const token=authorization.slice(7),parts=token.split('.');
    if(parts.length!==2 || parts[0].length>250 || parts[1].length!==43)return false;
    const expected=tokenSignature(parts[0]);
    if(!crypto.timingSafeEqual(Buffer.from(parts[1]),Buffer.from(expected)))return false;
    try {
      const data=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));
      return Number.isFinite(data.exp) && data.exp>Date.now() && data.exp<Date.now()+3700000;
    }catch{return false;}
  }
  function readJson(req,done){
    if(!String(req.headers['content-type']||'').toLowerCase().startsWith('application/json')){
      return done(Error('JSON形式で送信してください'));
    }
    let data='',bytes=0,finished=false;
    req.on('data',chunk=>{
      if(finished)return;
      bytes+=chunk.length;
      if(bytes>4096){finished=true;req.resume();done(Error('リクエストが大きすぎます'));return;}
      data+=chunk.toString('utf8');
    });
    req.on('end',()=>{
      if(finished)return;
      finished=true;
      try{const v=JSON.parse(data);if(!v||typeof v!=='object'||Array.isArray(v))throw Error('invalid');done(null,v)}
      catch{done(Error('JSONを読み取れませんでした'));}
    });
    req.on('error',()=>{if(!finished){finished=true;done(Error('通信エラー'));}});
  }
  function currentCatalog(full){
    const ids=full?[...original.keys()]:legacyIds;
    const products=ids.map(id=>{
      const def=original.get(id);
      const edit=state.overrides[id]||{};
      return {...def,...edit};
    });
    return {version:String(catalog.version)+'-live-'+state.revision+(full?'-62':'-27'),
      updatedAt:new Date().toISOString().slice(0,10),title:full?'Block Pop! ライブショップ 62種類':'Block Pop! レトロショップ27種類',items:products};
  }
  function serveCatalog(req,res,url){
    const params=new URL(req.url||url,'http://localhost').searchParams;
    const full=params.get('schema')==='2' || params.get('schema')==='full';
    // Old v1.2.4 sends a 62-item ETag without a schema. Prefer 62 for it.
    const cachedHeader=String(req.headers['if-none-match']||'');
    const selectFull=full || (!params.has('schema') && cachedHeader.includes('62'));
    const encoded=Buffer.from(JSON.stringify(currentCatalog(selectFull)),'utf8');
    const etag='W/"'+hash(encoded)+'"';
    res.setHeader('Cache-Control','public, no-cache, must-revalidate');
    res.setHeader('ETag',etag);
    res.setHeader('X-BlockPop-Catalog-Schema',selectFull?'2':'1');
    res.setHeader('Access-Control-Expose-Headers','ETag, X-BlockPop-Catalog-Schema');
    if(cachedHeader===etag){res.writeHead(304);return res.end();}
    const gzip=String(req.headers['accept-encoding']||'').includes('gzip');
    const payload=gzip?zlib.gzipSync(encoded,{level:6}):encoded;
    res.writeHead(200,{'Content-Type':'application/json; charset=utf-8',
      'Content-Encoding':gzip?'gzip':'identity','Content-Length':payload.length});
    res.end(payload);
  }
  function publicGift(g){
    return {id:g.id,title:g.title,description:g.description,coins:g.coins,
      itemId:g.itemId,qty:g.qty,enabled:!!g.enabled,createdAt:g.createdAt};
  }
  function publicGifts(){return state.gifts.filter(x=>x.enabled).slice(-30).reverse().map(publicGift);}
  const write=(res,onChange)=>{
    const snapshot=JSON.stringify(state);
    try{onChange();state.revision++;persist();status(res,200,{ok:true,revision:state.revision});}
    catch(e){state=JSON.parse(snapshot);status(res,503,{error:'保存に失敗しました。サーバーの状態を確認してください'});}
  };
  function handle(req,res,url){
    if(url!=='/api/shop/catalog' && !url.startsWith('/api/gifts') && !url.startsWith('/api/admin/'))return false;
    if(!cors(req,res)){status(res,403,{error:'許可されていない接続元です'});return true;}
    if(req.method==='OPTIONS'){res.writeHead(204);res.end();return true;}
    if(url==='/api/shop/catalog' && req.method==='GET'){
      serveCatalog(req,res,url);return true;
    }
    if(url==='/api/gifts' && req.method==='GET'){
      status(res,200,{version:state.revision,gifts:publicGifts()});return true;
    }
    if(url==='/api/gifts/claim' && req.method==='POST'){
      if(!limit(CLAIM_LIMIT,req,40,60000)){status(res,429,{error:'しばらくしてから受け取ってね'});return true;}
      readJson(req,(e,v)=>{
        if(e){status(res,400,{error:e.message});return;}
        if(!v || !/^[a-f0-9]{32}$/.test(v.playerId||'') || !validId(v.giftId)){
          status(res,400,{error:'受け取りデータを確認してください'});return;
        }
        const g=state.gifts.find(x=>x.id===v.giftId);
        if(!g){status(res,404,{error:'プレゼントが見つかりません'});return;}
        const playerKey=hash(v.playerId);
        if(g.claims?.[playerKey]){status(res,200,{ok:true,already:true,gift:publicGift(g)});return;}
        if(!g.enabled){status(res,410,{error:'このプレゼントは配布終了しました'});return;}
        const oldRevision=state.revision;
        g.claims=g.claims||{};g.claims[playerKey]=Date.now();state.revision++;
        try{persist();status(res,200,{ok:true,already:false,gift:publicGift(g)});}
        catch(err){delete g.claims[playerKey];state.revision=oldRevision;status(res,503,{error:'サーバー保存に失敗しました'});}
      });return true;
    }
    if(url==='/api/admin/login' && req.method==='POST'){
      if(!adminReady){status(res,503,{error:'管理者認証はサーバーで未設定です'});return true;}
      if(!limit(LOGIN_LIMIT,req,12,5*60*1000)){status(res,429,{error:'入力回数が多いため5分後に試してください'});return true;}
      readJson(req,(e,v)=>{
        if(e){status(res,400,{error:e.message});return;}
        const code=typeof v.code==='string'?v.code:'';
        const expected=Buffer.from(adminHash,'hex');
        const incoming=crypto.createHash('sha256').update(code,'utf8').digest();
        if(code.length<8 || code.length>100 || !crypto.timingSafeEqual(incoming,expected)){
          status(res,401,{error:'管理者コードが違います'});return;
        }
        status(res,200,{token:issueToken(),expiresInSeconds:3600});
      });return true;
    }
    if(url.startsWith('/api/admin/')){
      if(!authenticated(req)){status(res,401,{error:'管理者ログインが必要です'});return true;}
      if(url==='/api/admin/state' && req.method==='GET'){
        status(res,200,{revision:state.revision,shop:[...original.values()].map(x=>({id:x.id,name:x.name,
          defaultPrice:x.price,price:state.overrides[x.id]?.price??x.price,
          badge:state.overrides[x.id]?.badge??x.badge??''})),
          gifts:state.gifts.map(g=>({...publicGift(g),claims:Object.keys(g.claims||{}).length})).reverse(),
          storage:'temporary'});return true;
      }
      if(url==='/api/admin/shop' && req.method==='POST'){
        readJson(req,(e,v)=>{
          if(e){status(res,400,{error:e.message});return;}
          if(!validId(v.id)||!original.has(v.id)){status(res,400,{error:'商品がありません'});return;}
          if(v.reset===true){write(res,()=>{delete state.overrides[v.id]});return;}
          if(!Number.isInteger(v.price)||v.price<0||v.price>9999 || typeof v.badge!=='string'||v.badge.length>18 || /[<>"'`\\\r\n]/.test(v.badge)){
            status(res,400,{error:'価格は0～9999、ラベルは18文字以下にしてね'});return;
          }
          write(res,()=>{state.overrides[v.id]={price:v.price,badge:safeLabel(v.badge)}});
        });return true;
      }
      if(url==='/api/admin/gift' && req.method==='POST'){
        readJson(req,(e,v)=>{
          if(e){status(res,400,{error:e.message});return;}
          if(v.action==='toggle'){
            const g=state.gifts.find(x=>x.id===v.id);
            if(!g||typeof v.enabled!=='boolean'){status(res,400,{error:'対象が見つかりません'});return;}
            write(res,()=>{g.enabled=v.enabled});return;
          }
          if(v.action!=='create' && v.action!=='edit'){
            status(res,400,{error:'不明な操作です'});return;
          }
          const name=safeText(v.title,38),description=safeText(v.description,120);
          const itemId=safeText(v.itemId||'',48);
          if(!name || /[<>]/.test(name+description) || !Number.isInteger(v.coins)||v.coins<0||v.coins>1000 ||
            !Number.isInteger(v.qty)||v.qty<0||v.qty>10 || !(itemId===''||original.has(itemId)) ||
            (itemId!=='' && original.get(itemId).mode==='pack') || (v.qty>0&&!itemId) || (v.qty===0&&itemId) ||
            (v.coins===0 && v.qty===0)){
            status(res,400,{error:'プレゼント名と報酬を確認してください（コイン最大1000、アイテム最大10）'});return;
          }
          if(v.action==='create'){
            if(state.gifts.length>=30){status(res,400,{error:'プレゼントの登録数が上限です'});return;}
            const id='gift-'+crypto.randomBytes(8).toString('hex');
            write(res,()=>state.gifts.push({id,title:name,description,coins:v.coins,itemId,qty:v.qty,
              enabled:true,createdAt:Date.now(),claims:{}}));return;
          }
          const g=state.gifts.find(x=>x.id===v.id);
          if(!g){status(res,404,{error:'プレゼントが見つかりません'});return;}
          if(Object.keys(g.claims||{}).length>0){status(res,409,{error:'受け取り済みのプレゼントは報酬を変更できません。新規作成してね'});return;}
          write(res,()=>Object.assign(g,{title:name,description,coins:v.coins,itemId,qty:v.qty}));
        });return true;
      }
      status(res,404,{error:'管理者操作が見つかりません'});return true;
    }
    status(res,404,{error:'APIが見つかりません'});return true;
  }
  return {handle, isAdmin:authenticated, configured:adminReady};
};
