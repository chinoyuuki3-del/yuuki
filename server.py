from __future__ import annotations

import asyncio
import os
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, JSONResponse

app = FastAPI(
    title="Troll Engine Realtime Server",
    version="1.0.4",
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


@app.get("/", response_class=HTMLResponse)
async def root() -> HTMLResponse:
    online = await manager.count()
    html = f"""<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Troll Engine</title>
<style>
*{{box-sizing:border-box}}
body{{margin:0;background:#08111f;color:#f4f8ff;font-family:Arial,'Noto Sans JP',sans-serif;min-height:100vh}}
main{{max-width:900px;margin:0 auto;padding:32px 18px}}
header{{display:flex;align-items:center;justify-content:space-between;gap:16px;flex-wrap:wrap;margin-bottom:24px}}
h1{{font-size:36px;margin:0}}
.sub{{color:#9fb1c7;margin-top:6px}}
.badge{{background:#10371f;color:#92f7b0;border:1px solid #2d7d47;padding:10px 16px;border-radius:999px;font-weight:700}}
.grid{{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}}
.card{{background:#101d30;border:1px solid #263b56;border-radius:18px;padding:20px;box-shadow:0 10px 30px #0004}}
.label{{color:#8ea4bd;font-size:12px;text-transform:uppercase;letter-spacing:.1em}}
.value{{font-size:25px;font-weight:800;margin-top:8px}}
.big{{margin-top:18px;padding:24px}}
.big h2{{margin-top:0}}
code{{display:block;background:#050a12;border:1px solid #22354e;padding:13px;border-radius:12px;color:#a7e8ff;overflow-wrap:anywhere}}
a{{color:#71d4ff}}
@media(max-width:650px){{.grid{{grid-template-columns:1fr}}h1{{font-size:30px}}}}
</style>
</head>
<body>
<main>
<header>
<div><h1>⚡ Troll Engine</h1><div class="sub">Realtime Communication Server</div></div>
<div class="badge">● ONLINE</div>
</header>
<section class="grid">
<div class="card"><div class="label">Version</div><div class="value">1.0.4</div></div>
<div class="card"><div class="label">Online</div><div class="value">{online}</div></div>
<div class="card"><div class="label">Health</div><div class="value">OK</div></div>
</section>
<section class="card big">
<h2>Server UI is working ✅</h2>
<p>このカードが見えていれば、HTML UI版がHostlessに反映されています。</p>
<div class="label">WebSocket</div>
<code>wss://troll-engine-server.hostless.app/ws</code>
<p><a href="/health">Health JSON</a> / <a href="/api/status">Status JSON</a></p>
</section>
</main>
</body>
</html>"""
    return HTMLResponse(content=html, status_code=200, headers={"Cache-Control": "no-store, max-age=0"})


@app.get("/api/status")
async def api_status() -> JSONResponse:
    return JSONResponse({
        "name": "Troll Engine Realtime Server",
        "status": "online",
        "version": app.version,
        "websocket": "/ws",
        "health": "/health",
        "online": await manager.count(),
        "time": now_iso(),
    })


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
    await manager.broadcast({"type": "presence", "event": "join", "online": await manager.count(), "time": now_iso()})
    try:
        while True:
            message = await websocket.receive_text()
            await manager.broadcast({"type": "message", "data": message, "online": await manager.count(), "time": now_iso()})
    except WebSocketDisconnect:
        pass
    finally:
        await manager.disconnect(websocket)
        await manager.broadcast({"type": "presence", "event": "leave", "online": await manager.count(), "time": now_iso()})


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", "8000"))
    print(f"HOSTLESS_UI_1_0_4 listening on 0.0.0.0:{port}", flush=True)
    uvicorn.run(app, host="0.0.0.0", port=port, log_level="info")
