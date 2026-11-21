# Noah HRM

## 本機開發

安裝 Node.js 20.12 以上及 Docker Desktop。等 Docker Desktop 顯示 Engine running 後，在 noah-hrm 執行。

~~~cmd
npm start
~~~

開啟 [HRM](http://localhost:4201/)。Angular 與 Spring Boot（3001）會獨立啟動，並和 Portal 共用本機 Keycloak（8081）與 PostgreSQL（5433）。Windows 沒有 JDK 21 時會下載到專案的 tmp 目錄。測試登入字號為 H247386514（測試專用），初始密碼在 .env.shared-keycloak 的 KEYCLOAK_DEMO_PASSWORD。登入後點「變更密碼」，換好的密碼可登入兩邊。

自行指定本機網頁 port 時，在 PowerShell 設定 $env:HRM_PORT = "4202" 再執行 npm start。使用預設的本機 Keycloak 時，啟動程式會登錄相符的回呼。後端 port 可用 HRM_BACKEND_PORT 設定。

## 共用測試環境

如果團隊有共用 Keycloak 和 PostgreSQL，把 .env.local.example 複製成 .env.local，再填入該環境的設定。HRM 用自己的機密 OIDC client，啟用 Standard Flow 和 PKCE S256，允許 http://localhost:4201/auth/callback，換 port 時一併換回呼。帳號管理 client 需啟用服務帳號並授予 realm-management 的 manage-users。HRM_ADMIN_SUBJECT 填有員工管理權限的 Keycloak 使用者 ID。Portal 與 HRM 若使用同一個 realm，可沿用瀏覽器的 Keycloak 登入狀態。

## HRM 上線步驟

要部署別的網站，可以看 [通用部署清單](https://github.com/Dandy1103/noah-portal/blob/develop/docs/DEPLOYMENT.md#通用部署清單)。

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
