# BOYS HUB v3 — Neonクラウド保存 + 管理者招待

## サイト
https://boys-hub-sns.onrender.com

既存のRender Web Service（`boys-hub-sns`）と、別プロジェクトのNeon PostgreSQL（`BOYS HUB SNS`）を使う構成。

## ログインと招待
- 初回だけ「初代管理者パスワード」で最初のユーザー登録が必要。これにより初代管理者 `owner` が1名確定し、DBのフラグで再利用できなくなる。
- それ以降の一般ユーザー登録は、招待コード `男子` と別の本人パスワードで行う。「男子」は性別の確認手段ではない。
- 初代管理者や招待された管理者は、管理パネルから48時間有効の使い捨て招待コードを発行できる。
- そのコードを新規登録時の招待コードに入れると、管理者として登録される。すでに登録した一般ユーザーも「ルール」ページからコードを入力して管理者になれる。
- 招待コードはデータベースにSHA-256ハッシュとして保存され、元の値は発行時にだけ表示される。
- ユーザーのパスワードはPBKDF2でハッシュ保存。セッションCookieは署名済みHttpOnlyで、認可判定はサーバー側。
- 管理者はユーザーを停止/解除し、投稿の削除や通報対応が可能。一般ユーザーは管理者を停止できない。

## データ保存
ユーザー・動画・いいね・コメント・招待・通報はNeonのPostgreSQLに保存。無料プランの容量・利用上限はNeonに準拠。
**クラウドでも永遠の保存保証はない**ので、バックアップを定期的に取る。動画は8MiBまででPostgreSQL内に保存。大規模運用にはオブジェクトストレージへの切替を推奨。

## 運用環境変数（Render Web Service > Environment）
```
DATABASE_URL=（Neonから取得した秘密のPostgreSQL接続文字列）
APP_ENV=production
SESSION_SECRET=（十分にランダムな長い文字列）
OWNER_SETUP_CODE=（初回オーナー登録の時だけ使う秘密の長い文字列）
INVITE_CODE=男子
```
既存バージョンの `ADMIN_USERNAME` / `ADMIN_PASSWORD` は **v3では使われず、自動管理者アカウントも作成しない**。
これらの秘密情報をGitHubやチャットなどに公開しない。
`OWNER_SETUP_CODE` は初回登録後も環境変数に残り得るが、初代管理者が登録済みならバックエンドは絶対に再利用しない。

### ローカル実行・テスト
```
pip install -r requirements.txt
export OWNER_SETUP_CODE='use-a-random-very-long-secret-only-for-local-development'
uvicorn main:app --host 127.0.0.1 --port 8000
pytest -q test_smoke.py
```
ローカルはSQLiteを使う。公開サイトは必ずPostgreSQLの `DATABASE_URL` を設定して本番モードにする。

### セキュリティ上の注意
招待コードが漏れると招待先で管理者権限が付与されるため、人選とコードの共有に注意する。公開動画には個人情報・肖像権や著作権の確認が必要。自動キーワード検出のみで動画内容をすべて審査できるわけではない。試運転規模を超える場合は通報対応体制・監視・レート制限・バックアップ・プライバシー方針を整備する。
