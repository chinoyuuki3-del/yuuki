# RBX9 Compat Online

Cloud multiplayer substitute for the RBX9 iOS 9 client.

This service does **not** impersonate Roblox authentication or Roblox game servers. It replaces only the unavailable private player-session/replication layer with a small RBX9-compatible state-sync service.

Endpoints:
- GET /health
- POST /v1/session/join
- POST /v1/session/input
- GET /v1/session/state
- POST /v1/session/leave
