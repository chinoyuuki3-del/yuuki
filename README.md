# Troll Engine Hostless Server

Hostless で動かす Troll Engine のリアルタイム通信サーバーです。

## Hostless

- Build System: Docker
- Dockerfile: `./Dockerfile`
- Start Command: `uvicorn app:app --host 0.0.0.0 --port $PORT`
- Health Check: `/health`
- WebSocket: `/ws`

## API

- `GET /` サーバー状態
- `GET /health` ヘルスチェック
- `WS /ws` リアルタイム通信

Hostless の GitHub リポジトリ選択で `chinoyuuki3-del/yuuki` を選んでください。
