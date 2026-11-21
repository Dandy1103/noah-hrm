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

## 打包

先執行 npm run build，再執行 mvnw.cmd package。從專案目錄啟動 target/noah-hrm.jar，會同時供應 Angular 網頁與 HRM API。部署時設定 APP_ORIGIN 為 HRM 的 HTTPS 網址、登錄對應的 /auth/callback，並提供上面的環境變數。
