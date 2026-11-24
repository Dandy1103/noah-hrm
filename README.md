# Noah HRM

## 本機開發

本機登入跟 Portal／線上同一套 Cloud-IAM。完整步驟看 Portal 的 [本機登入說明](https://github.com/Dandy1103/noah-portal/blob/develop/docs/DEPLOYMENT.md#本機登入跟線上同一套-cloud-iam)（本機檔案在 `noah-portal/docs/DEPLOYMENT.md`）。

```cmd
copy .env.local.example .env.local
```

填 `OIDC_CLIENT_SECRET`（Cloud-IAM → Clients → `noah-hrm` → Credentials）和 `DATABASE_URL`。Cloud-IAM 要允許 `http://localhost:4201/auth/callback`。

```cmd
npm start
```

開 [HRM](http://localhost:4201/)。登入走本機 `noah-core`（`127.0.0.1:8080`）和 Cloud-IAM，不是本機 8081。先啟動 core。換前端 port：`$env:HRM_PORT = "4202"`，並在 Cloud-IAM 的 `noah-core` client 補 `http://localhost:4202/login/oauth2/code/noah`。後端 port 可用 `HRM_BACKEND_PORT`。

沒有 `.env.local` 時才會退回本機 Keycloak（8081）備援。

## 資料庫遷移

HRM 啟動時會對設定的 PostgreSQL 執行 Flyway 遷移。如果只想更新結構，或要在全新的資料庫先啟動 Portal，在 `noah-hrm` 執行 `npm run db:migrate`。這個指令不會啟動 HRM 網站。

變更員工或部門資料表時，在 [資料庫遷移目錄](backend/src/main/resources/db/migration) 新增下一個版本的 SQL，例如 `V2__add_employee_extension.sql`，和功能一起提交。已套用的遷移檔保留原樣，後續修正另開新版本。Git 管理遷移 SQL 和可重建的測試資料，員工資料、資料庫備份及憑證留在各自的環境。

Railway 可在 **HRM → Settings → Deploy → Pre-deploy Command** 填入 `java -jar noah-hrm.jar migrate`。如果同一版也改到 Portal 的資料查詢，先部署 HRM 並確認遷移成功，再部署 Portal。 [Railway 部署前指令](https://docs.railway.com/deployments/pre-deploy-command)

## 共用測試環境

如果團隊有共用 Keycloak 和 PostgreSQL，把 .env.local.example 複製成 .env.local，再填入該環境的設定。HRM 用自己的機密 OIDC client，啟用 Standard Flow 和 PKCE S256，允許 http://localhost:4201/auth/callback，換 port 時一併換回呼。帳號管理 client 需啟用服務帳號並授予 realm-management 的 manage-users。HRM_ADMIN_SUBJECT 填有員工管理權限的 Keycloak 使用者 ID。Portal 與 HRM 若使用同一個 realm，可沿用瀏覽器的 Keycloak 登入狀態。

## HRM 上線步驟

要部署別的網站，可以看 [通用部署清單](https://github.com/Dandy1103/noah-portal/blob/develop/docs/DEPLOYMENT.md#通用部署清單)。本機文件在 [docs](docs/deployment.md)，GitHub 金鑰看 [GitHub Packages 金鑰](docs/github-packages.md)。

打開 Portal 用的 Railway 專案，新增一個 HRM 服務。登入沿用 Portal 的 Keycloak realm，正式網址用 `https://noahhrm.dandy-cheng.com`。

### 1. 把部署檔推到 GitHub

把 HRM 根目錄的 `Dockerfile` 和 `.dockerignore` 推到 Railway 接的 `develop`。Railway 讀到根目錄的 Dockerfile 後，會用它打包 Angular 和 Java。 [Railway Dockerfile 說明](https://docs.railway.com/builds/dockerfiles)

```powershell
git switch develop
git add Dockerfile .dockerignore
git commit -m "Add HRM deployment Dockerfile"
git push origin develop
```

### 2. 在 Railway 建立 HRM

在 Railway 新增服務，點 **GitHub Repo**，搜尋並選 `Dandy1103/noah-hrm`。到 HRM 服務的 **Settings → Source → Branch** 選 `develop`，再把 **Healthcheck Path** 填成 `/healthz`。

到 HRM 服務的 **Settings → Networking → Public Networking** 點 **Custom Domain**，填 `noahhrm.dandy-cheng.com`。到 Spaceship 的 `dandy-cheng.com` → **Advanced DNS**，把 Railway 顯示的 **CNAME** 和 **TXT** 各加一筆，Host 和 Value 照畫面填。回 Railway 等網域驗證和 HTTPS 就緒。 [Railway 自訂網域](https://docs.railway.com/networking/domains/working-with-domains#custom-domains)

### 3. 設好登入和資料庫

#### 先在 Keycloak 建登入用的 client

1. 打開 `noah-identity` realm，點 **Clients → Create client**。Client type 選 **OpenID Connect**，Client ID 填 `noah-hrm`，按 **Next**。
2. 開啟 **Client authentication** 和 **Standard flow**，按 **Next**。
3. 在 **Valid redirect URIs** 貼上 `https://noahhrm.dandy-cheng.com/auth/callback`，按 **Save**。
4. 到 **Credentials** 複製 **Client secret**。下一步把它貼到 Railway 的 `OIDC_CLIENT_SECRET`。

**PKCE method 可以留空。** HRM 和 Portal 的程式登入時都會送 `S256`。留空時，Keycloak 還是會驗證收到的 PKCE。選 `S256` 則會強制這個 client 的登入請求都要用 `S256`。 [Keycloak PKCE 說明](https://www.keycloak.org/docs/latest/server_admin/#_oidc_clients)

#### 回 Railway 填設定

**正式上線、要能新增員工帳號的話，下面 8 筆都要填。只測登入可以先填前 4 筆。**

在 Railway 點 **HRM 服務 → Variables → New Variable**，照下面的表一項一項填。要找 secret，就到 Keycloak 點對應的 client，再點 **Credentials**。 [Railway 變數設定](https://docs.railway.com/variables)

| 什麼時候要填 | 名稱 | 值那欄填什麼 |
| --- | --- | --- |
| 登入 | `APP_ORIGIN` | `https://noahhrm.dandy-cheng.com` |
| 登入 | `OIDC_ISSUER_URL` | 複製 Portal 服務裡同名的值 |
| 登入 | `OIDC_CLIENT_ID` | `noah-hrm` |
| 登入 | `OIDC_CLIENT_SECRET` | `noah-hrm` 的 Client secret |
| 查詢或管理員工 | `HRM_ADMIN_SUBJECT` | Keycloak 裡 HRM 管理員帳號的 **User ID** |
| 查詢或管理員工 | `DATABASE_URL` | 員工 PostgreSQL 的連線網址，使用 `postgresql://` 或 `postgres://` |
| 新增、修改或停用員工帳號 | `HRM_KEYCLOAK_CLIENT_ID` | `noah-hrm-management` |
| 新增、修改或停用員工帳號 | `HRM_KEYCLOAK_CLIENT_SECRET` | `noah-hrm-management` 的 Client secret |

要管理員工帳號，再回 Keycloak 的 **Clients** 建 `noah-hrm-management`。開啟 **Client authentication** 和 **Service accounts roles**，關閉 **Standard flow** 和 **Direct access grants**。在 **Service account roles** 加入 `realm-management` 的 `manage-users`，並確認 client scope 允許該角色。 [Keycloak 設定](https://www.keycloak.org/docs/latest/server_admin/#_service_accounts)

設定好就回 Railway 按 **Deploy**。`PORT` 由 Railway 提供。要讓 Portal 首頁連到 HRM，下一步到 **Portal 服務**填 `HRM_URL`。

### 4. 測過 HRM，再加到 Portal

打開 HRM 網址，用管理員帳號登入，試著新增一筆測試員工。成功後，回 Railway 點 **Portal 服務 → Variables**，把 `HRM_URL` 填成 `https://noahhrm.dandy-cheng.com`，再按 **Deploy**。最後登入 Portal，從首頁點 **Noah HRM**，看看能不能直接進去。
