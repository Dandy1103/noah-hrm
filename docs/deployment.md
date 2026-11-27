# HRM 部署

HRM 以前端成品進入 `noah-platform`，不單獨部署後端或 Keycloak。

推上 `develop` 或 `main` 會執行 [publish-platform.yml](../.github/workflows/publish-platform.yml)，產出 `platform-<branch>-<commit>`。`develop` 會請 Platform 更新對應頻道。使用者從 Shell 的 `/hrm` 進入，靜態檔在 `/remotes/hrm/`。

組裝方式與 Railway 的 `PLATFORM_CHANNEL`、`CORE_URL` 看 [noah-platform](https://github.com/Dandy1103/noah-platform)。

本機執行 `npm start`。登入與 API 經 noah-apps 的 proxy 轉到 develop Core，說明見 Portal 的 [本機登入說明](https://github.com/Dandy1103/noah-portal/blob/develop/docs/DEPLOYMENT.md#本機登入跟線上同一套-cloud-iam)。

安裝 `@dandy1103/ui` 的 GitHub 金鑰看 [GitHub Packages 金鑰](github-packages.md)。金鑰寫在這台電腦的環境變數，不要寫進 Git。
