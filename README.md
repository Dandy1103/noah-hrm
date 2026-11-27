# Noah HRM

## 本機開發

本機開發沿用 noah-apps 的 federated 啟動方式：`npm start` 會啟動或沿用旁邊的 Shell、編譯 HRM remote，並開啟 `/hrm`。登入與 API 經 noah-apps 相同的 proxy 轉送到 develop Core。完整登入步驟看 Portal 的 [本機登入說明](https://github.com/Dandy1103/noah-portal/blob/develop/docs/DEPLOYMENT.md#本機登入跟線上同一套-cloud-iam)（本機檔案在 `noah-portal/docs/DEPLOYMENT.md`）。

```cmd
npm start
```

瀏覽器會開啟 Shell 的 [HRM 路由](http://localhost:4200/hrm)。和 noah-apps 一樣，這個流程會同時啟動 Shell（若尚未啟動）與 HRM remote，不需要在 HRM 專案安裝 JDK。


## 資料庫遷移

HRM 的資料庫遷移由 `noah-core` 啟動時執行。HRM 前端不再啟動獨立 Java 後端，也不提供資料庫遷移指令。

變更員工或部門資料表時，在 `noah-core/src/main/resources/db/hrm` 的資料庫遷移目錄新增下一個版本 SQL，和 Core 功能一起提交。已套用的遷移檔保留原樣，後續修正另開新版本。Git 管理遷移 SQL 和可重建的測試資料，員工資料、資料庫備份及憑證留在各自的環境。

新增 HRM 資料庫遷移時，部署包含該 migration 的 `noah-core`；Core 啟動時會套用遷移。

## 共用測試環境

HRM 前端不直接連 Keycloak 或資料庫。登入與 API 由 `noah-core` 提供，本機透過和 noah-apps 相同的 proxy 轉送到 develop Core；HRM 不需要 `.env.local`、本機 Keycloak 或資料庫設定。HRM 的後端環境與帳號管理設定請在 `noah-core` 維護。

## 上線

HRM 的 PR 以 `master` 為目標，CI 會驗證前端建置。合併到 `master` 後，GitHub Actions 會將成品發佈到 GHCR，再通知 `noah-platform` 更新開發環境的 lock。Railway 由 Platform 的 `master` 部署整站，使用者從 Shell 的 `/hrm` 進入。

日常發佈不建立 HRM Git tag。整站驗收後，需要標記版本時，在 `noah-platform` 手動建立版本 tag。

登入、資料庫和員工帳號的環境變數在 `noah-core`。Platform 的組裝與 Railway 變數看 [noah-platform](https://github.com/Dandy1103/noah-platform)。本機說明在 [docs/deployment.md](docs/deployment.md)，GitHub Packages 金鑰在 [docs/github-packages.md](docs/github-packages.md)。
