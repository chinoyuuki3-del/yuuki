import os, time, threading, uuid
from flask import Flask, request, jsonify

app = Flask(__name__)
LOCK = threading.Lock()
ROOMS = {}
TTL = 45

WORLD = {
    "name": "RBX9 Plaza",
    "spawn": [0.0, 1.05, 0.0],
    "blocks": [
        [-3.0,0.5,-3.0,1.0], [2.0,0.5,-5.0,1.0], [4.0,1.0,-1.0,2.0],
        [-5.0,1.0,2.0,2.0], [0.0,0.5,5.0,1.0]
    ]
}

def now():
    return time.time()

def clean():
    cutoff = now() - TTL
    with LOCK:
        for room in list(ROOMS.values()):
            dead = [pid for pid,p in room["players"].items() if p["seen"] < cutoff]
            for pid in dead:
                room["players"].pop(pid, None)

@app.get("/health")
def health():
    clean()
    with LOCK:
        return jsonify(
            ok=True,
            service="RBX9 Compat Online",
            rooms=len(ROOMS),
            players=sum(len(r["players"]) for r in ROOMS.values())
        )

@app.post("/v1/session/join")
def join():
    body = request.get_json(silent=True) or {}
    room_id = str(body.get("room") or "public")[:48]
    name = str(body.get("name") or "Player")[:24]
    player_id = uuid.uuid4().hex[:16]
    token = uuid.uuid4().hex
    with LOCK:
        room = ROOMS.setdefault(room_id, {"players": {}, "seq": 0})
        room["players"][player_id] = {
            "id": player_id, "name": name,
            "x": 0.0, "y": 1.05, "z": 0.0, "yaw": 0.0,
            "seen": now(), "token": token
        }
        room["seq"] += 1
    return jsonify(
        ok=True, room=room_id, playerId=player_id, token=token, tickHz=8,
        world=WORLD
    )

def auth(room_id, player_id, token):
    room = ROOMS.get(room_id)
    p = room and room["players"].get(player_id)
    return room, p if p and p.get("token") == token else None

@app.post("/v1/session/input")
def inp():
    body = request.get_json(silent=True) or {}
    room_id = str(body.get("room") or "public")
    pid = str(body.get("playerId") or "")
    token = str(body.get("token") or "")
    with LOCK:
        room, p = auth(room_id, pid, token)
        if not p:
            return jsonify(ok=False, error="invalid_session"), 401
        for k in ("x","y","z","yaw"):
            if k in body:
                try:
                    p[k] = float(body[k])
                except (TypeError, ValueError):
                    pass
        p["seen"] = now()
        room["seq"] += 1
        return jsonify(ok=True, seq=room["seq"])

@app.get("/v1/session/state")
def state():
    room_id = str(request.args.get("room") or "public")
    pid = str(request.args.get("playerId") or "")
    token = str(request.args.get("token") or "")
    clean()
    with LOCK:
        room, p = auth(room_id, pid, token)
        if not p:
            return jsonify(ok=False, error="invalid_session"), 401
        p["seen"] = now()
        players = [
            {k:v for k,v in q.items() if k not in ("token","seen")}
            for q in room["players"].values()
        ]
        return jsonify(ok=True, seq=room["seq"], players=players)

@app.post("/v1/session/leave")
def leave():
    body = request.get_json(silent=True) or {}
    room_id = str(body.get("room") or "public")
    pid = str(body.get("playerId") or "")
    token = str(body.get("token") or "")
    with LOCK:
        room, p = auth(room_id, pid, token)
        if p:
            room["players"].pop(pid, None)
            room["seq"] += 1
    return jsonify(ok=True)

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", "10000")), threaded=True)
