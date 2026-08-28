from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.responses import JSONResponse

app = FastAPI(
    title="Troll Engine Realtime Server",
    version="1.0.0",
    description="Realtime HTTP + WebSocket server for Troll Engine.",
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


@app.get("/")
async def root() -> JSONResponse:
    return JSONResponse(
        {
            "name": "Troll Engine Realtime Server",
            "status": "online",
            "version": app.version,
            "websocket": "/ws",
            "online": await manager.count(),
            "time": now_iso(),
        }
    )


@app.get("/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
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
