# VHS City 配信ダッシュボード（GitHub Pages・運用終了）

このリポジトリの **GitHub Pages 版は運用を終了**しました。

## 新しいサイト（Cloudflare）

https://vhs-city-site-cf.pages.dev/

リポジトリ: https://github.com/Shohei-Tsuchiya/vhs-city-site-cf

## この Pages について

旧 URL（https://shohei-tsuchiya.github.io/vhs-city-site/）は、移転先への誘導ページのみを表示します。  
YouTube API による配信状況の更新は **行いません**（`Update Stream Status` は無効化済み）。

## cron-job.org を止める（重要）

GitHub 向けの定期更新が残っていると不要な Actions 起動の原因になるため、停止してください。

1. https://cron-job.org/ にログイン
2. ジョブ「VHS City 配信更新」（または `repository_dispatch` を叩いているジョブ）を開く
3. **無効化（Disable）** するか **削除**
4. 保存

（ジョブ URL は `https://api.github.com/repos/Shohei-Tsuchiya/vhs-city-site/dispatches` のようなもの）
