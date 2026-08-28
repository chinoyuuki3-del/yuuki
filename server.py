from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse

app = FastAPI(
    title="Troll Engine Realtime Server",
    version="1.1.0",
    description="Realtime HTTP + WebSocket server for Troll Engine on Hostless.",
)


class ConnectionManager:
    def __init__(self) -> None:
        self.connections: set[WebSocket] = set()
        self.lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        async with self.lock:
            self.connections.add(websocket)

    async def disconnect(self, websocket: WebSocket) -> None:
        async with self.lock:
            self.connections.discard(websocket)

    async def broadcast(self, payload: dict[str, Any]) -> None:
        async with self.lock:
            targets = list(self.connections)

        dead: list[WebSocket] = []
        for websocket in targets:
            try:
                await websocket.send_json(payload)
            except Exception:
                dead.append(websocket)

        if dead:
            async with self.lock:
                for websocket in dead:
                    self.connections.discard(websocket)

    async def count(self) -> int:
        async with self.lock:
            return len(self.connections)


manager = ConnectionManager()


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


async def status_payload() -> dict[str, Any]:
    return {
        "name": "Troll Engine Realtime Server",
        "status": "online",
        "version": app.version,
        "websocket": "/ws",
        "health": "/health",
        "online": await manager.count(),
        "time": now_iso(),
    }


@app.get("/", response_class=HTMLResponse)
async def root() -> HTMLResponse:
    return HTMLResponse(
        """<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Troll Engine Realtime Server</title>
<style>
:root{color-scheme:dark;--bg:#07111f;--card:#0d1b2d;--card2:#10243b;--line:#203650;--text:#eef7ff;--muted:#91a7bd;--accent:#4ade80;--blue:#38bdf8;--danger:#fb7185}
*{box-sizing:border-box}body{margin:0;min-height:100vh;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:radial-gradient(circle at 20% 0%,#123158 0,transparent 38%),linear-gradient(160deg,#06101d,#071827 55%,#07111f);color:var(--text)}
.wrap{max-width:980px;margin:0 auto;padding:28px 18px 44px}.hero{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin-bottom:18px}.brand{display:flex;gap:14px;align-items:center}.logo{width:52px;height:52px;border-radius:16px;background:linear-gradient(135deg,#22d3ee,#4ade80);display:grid;place-items:center;color:#062036;font-weight:900;font-size:24px;box-shadow:0 10px 35px #22d3ee30}.title h1{margin:0;font-size:clamp(24px,5vw,38px);letter-spacing:-.03em}.title p{margin:5px 0 0;color:var(--muted)}.pill{display:inline-flex;align-items:center;gap:8px;padding:9px 12px;border-radius:999px;background:#0a2a1b;border:1px solid #1f6f43;color:#b8ffd1;font-weight:700;white-space:nowrap}.dot{width:9px;height:9px;background:var(--accent);border-radius:50%;box-shadow:0 0 14px var(--accent)}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin:16px 0}.card{background:linear-gradient(180deg,var(--card2),var(--card));border:1px solid var(--line);border-radius:18px;padding:16px;box-shadow:0 10px 30px #0004}.label{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.08em}.value{font-size:21px;font-weight:800;margin-top:6px;overflow-wrap:anywhere}.value.small{font-size:15px}.console{margin-top:12px}.consoleHead{display:flex;justify-content:space-between;align-items:center;gap:10px;margin-bottom:12px}.consoleHead h2{margin:0;font-size:19px}.buttons{display:flex;gap:8px}.btn{border:1px solid var(--line);background:#12253a;color:var(--text);padding:9px 13px;border-radius:11px;font-weight:700;cursor:pointer}.btn.primary{background:#0d7044;border-color:#168353}.btn.danger{background:#55202c;border-color:#7c293a}.btn:disabled{opacity:.45;cursor:not-allowed}.log{height:280px;overflow:auto;background:#050b13;border:1px solid #1c3147;border-radius:14px;padding:12px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px;line-height:1.55}.entry{padding:5px 2px;border-bottom:1px solid #ffffff0b}.entry.system{color:#8cd7ff}.entry.presence{color:#a7f3d0}.entry.message{color:#f8fafc}.entry.error{color:#fda4af}.composer{display:grid;grid-template-columns:1fr auto;gap:9px;margin-top:10px}.composer input{width:100%;background:#08131f;border:1px solid var(--line);color:var(--text);border-radius:12px;padding:12px 13px;outline:none}.composer input:focus{border-color:#38bdf8}.footer{margin-top:18px;color:var(--muted);font-size:12px;text-align:center}
@media(max-width:760px){.hero{flex-direction:column}.grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:430px){.grid{grid-template-columns:1fr}.buttons{width:100%}.btn{flex:1}.consoleHead{align-items:flex-start;flex-direction:column}.composer{grid-template-columns:1fr}.composer .btn{width:100%}}
</style>
</head>
<body>
<main class="wrap">
  <section class="hero">
    <div class="brand">
      <div class="logo">TE</div>
      <div class="title"><h1>Troll Engine</h1><p>Realtime Communication Server</p></div>
    </div>
    <div class="pill"><span class="dot"></span><span id="serverState">ONLINE</span></div>
  </section>

  <section class="grid">
    <div class="card"><div class="label">Version</div><div class="value" id="version">1.1.0</div></div>
    <div class="card"><div class="label">Online</div><div class="value"><span id="online">0</span> clients</div></div>
    <div class="card"><div class="label">WebSocket</div><div class="value small">/ws</div></div>
    <div class="card"><div class="label">Health</div><div class="value small" id="health">Checking...</div></div>
  </section>

  <section class="card console">
    <div class="consoleHead">
      <h2>WebSocket Console</h2>
      <div class="buttons">
        <button class="btn primary" id="connectBtn">Connect</button>
        <button class="btn danger" id="disconnectBtn" disabled>Disconnect</button>
      </div>
    </div>
    <div class="log" id="log"><div class="entry system">Ready. Connect to test realtime messaging.</div></div>
    <div class="composer">
      <input id="messageInput" placeholder="メッセージを入力…" autocomplete="off">
      <button class="btn primary" id="sendBtn" disabled>Send</button>
    </div>
  </section>

  <div class="footer">Troll Engine Realtime Server • Hostless • FastAPI</div>
</main>
<script>
let socket=null;
const log=document.getElementById('log');
const connectBtn=document.getElementById('connectBtn');
const disconnectBtn=document.getElementById('disconnectBtn');
const sendBtn=document.getElementById('sendBtn');
const input=document.getElementById('messageInput');

function addLog(text,type='system'){
  const el=document.createElement('div'); el.className='entry '+type; el.textContent=text; log.appendChild(el); log.scrollTop=log.scrollHeight;
}
function setConnected(yes){
  connectBtn.disabled=yes; disconnectBtn.disabled=!yes; sendBtn.disabled=!yes;
}
function connect(){
  if(socket && socket.readyState<=1) return;
  const proto=location.protocol==='https:'?'wss':'ws';
  socket=new WebSocket(`${proto}://${location.host}/ws`);
  addLog('Connecting to /ws ...','system');
  socket.onopen=()=>{setConnected(true);addLog('WebSocket connected.','presence');refreshStatus();};
  socket.onmessage=(ev)=>{
    try{
      const data=JSON.parse(ev.data);
      if(typeof data.online==='number') document.getElementById('online').textContent=data.online;
      if(data.type==='presence') addLog(`Presence: ${data.event} | online=${data.online}`,'presence');
      else if(data.type==='message') addLog(`Message: ${data.data}`,'message');
      else addLog(ev.data,'message');
    }catch{addLog(ev.data,'message');}
  };
  socket.onerror=()=>addLog('WebSocket error.','error');
  socket.onclose=()=>{setConnected(false);addLog('WebSocket disconnected.','system');refreshStatus();};
}
function disconnect(){if(socket) socket.close();}
function send(){
  const text=input.value.trim();
  if(!text || !socket || socket.readyState!==WebSocket.OPEN) return;
  socket.send(text); input.value='';
}
async function refreshStatus(){
  try{
    const r=await fetch('/api/status',{cache:'no-store'}); const d=await r.json();
    document.getElementById('serverState').textContent=(d.status||'online').toUpperCase();
    document.getElementById('version').textContent=d.version;
    document.getElementById('online').textContent=d.online;
  }catch{document.getElementById('serverState').textContent='UNKNOWN';}
  try{
    const r=await fetch('/health',{cache:'no-store'}); const d=await r.json();
    document.getElementById('health').textContent=d.ok?'OK':'ERROR';
  }catch{document.getElementById('health').textContent='ERROR';}
}
connectBtn.onclick=connect; disconnectBtn.onclick=disconnect; sendBtn.onclick=send;
input.addEventListener('keydown',e=>{if(e.key==='Enter')send();});
refreshStatus(); setInterval(refreshStatus,5000);
</script>
</body>
</html>"""
    )


@app.get("/api/status")
async def api_status() -> JSONResponse:
    return JSONResponse(await status_payload())


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "troll-engine-server",
        "version": app.version,
        "online": await manager.count(),
        "time": now_iso(),
    }


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    await manager.broadcast(
        {
            "type": "presence",
            "event": "join",
            "online": await manager.count(),
            "time": now_iso(),
        }
    )

    try:
        while True:
            message = await websocket.receive_text()
            await manager.broadcast(
                {
                    "type": "message",
                    "data": message,
                    "online": await manager.count(),
                    "time": now_iso(),
                }
            )
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)
        await manager.broadcast(
            {
                "type": "presence",
                "event": "leave",
                "online": await manager.count(),
                "time": now_iso(),
            }
        )


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    print(f"HOSTLESS_DIRECT_SERVER_1_1_0 listening on 0.0.0.0:{port}", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
