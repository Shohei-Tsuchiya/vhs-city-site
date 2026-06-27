# VHS City 配信ダッシュボード

VHS City メンバーの YouTube **配信中** / **配信予定** を一覧表示する非公式ファンサイトです。  
GitHub Pages で公開し、GitHub Actions が 30 分おきに YouTube Data API で情報を更新します。

## 公開 URL（設定後）

```
https://<あなたのGitHubユーザー名>.github.io/vhs-city-site/
```

## 初回セットアップ

### 1. GitHub にリポジトリを作る

1. GitHub で **New repository** を作成
2. リポジトリ名の例: `vhs-city-site`
3. Public を選択

### 2. ローカルから push

```powershell
cd "D:\work\dev_plugins\vhs city site"
git init
git add .
git commit -m "Initial commit: VHS City stream dashboard"
git branch -M main
git remote add origin https://github.com/<ユーザー名>/vhs-city-site.git
git push -u origin main
```

### 3. YouTube API キーを GitHub Secrets に登録

1. リポジトリの **Settings** → **Secrets and variables** → **Actions**
2. **New repository secret**
3. Name: `YOUTUBE_API_KEY`
4. Value: Google Cloud で取得した API キー

### 4. GitHub Pages を有効化

1. **Settings** → **Pages**
2. **Build and deployment** → Source: **GitHub Actions**

### 5. 初回デプロイの確認

1. **Actions** タブで `Deploy VHS City Site` が成功するか確認
2. 数分後、Pages の URL を開く

手動で即実行する場合: Actions → `Deploy VHS City Site` → **Run workflow**

## ローカルでの動作確認

```powershell
cd "D:\work\dev_plugins\vhs city site"
copy .env.example .env
# .env に YOUTUBE_API_KEY=... を記入
npm run fetch
```

ブラウザで `index.html` を開くか、簡易サーバーで確認:

```powershell
npx --yes serve .
```

## メンバーの追加・修正

`data/members.json` を編集します。

```json
{ "name": "表示名", "handle": "YouTubeハンドル（@なし）" }
```

チャンネル ID が分かっている場合:

```json
{ "name": "従井ノラ", "channelId": "UCQYy35PowPpc6ImRH1TQgcw" }
```

**ビバップ高校・娯楽組** のハンドルは公式情報をもとに登録していますが、リブランディング直後のため誤りがある可能性があります。配信が拾えないメンバーがいたら YouTube の `@ハンドル` を確認して修正してください。

## API クォータについて

YouTube Data API の無料枠は **1日 10,000 ユニット** です。  
`search` は 1 回 100 ユニット消費するため、全メンバーを毎回チェックすると枠を超えます。

そのため本サイトでは:

- **30 分おき** に **2 名ずつ** ローテーションでチェック
- 全メンバーが更新されるまで最大約 15 時間程度

配信チェックをもっと頻繁にしたい場合は、Google Cloud Console でクォータ増加を申請するか、`MEMBERS_PER_RUN` や cron 間隔を調整してください（`.github/workflows/deploy.yml`）。

## 構成

```
index.html              フロントページ
css/style.css           VHS 風スタイル
js/app.js               表示ロジック
data/members.json       メンバー定義
data/status.json        配信状況（Actions が更新）
scripts/fetch-youtube-status.mjs
.github/workflows/deploy.yml
```

## 免責

本サイトは **非公式のファン制作** です。株式会社 viviON および VHS City 公式とは関係ありません。
