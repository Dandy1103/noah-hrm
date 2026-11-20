const portalOrigin = process.env.HRM_DEV_PORTAL_ORIGIN;
const portalCookie = '__Host-noah.sid';
const localCookie = 'noah.hrm-dev.sid';

const proxyConfig = {};
const isSignIn = (request) => request.url?.startsWith('/auth/hrm-dev/');

function returnToHrm(response, error) {
  response.writeHead(302, {
    Location: '/?authError=' + error,
    'Cache-Control': 'no-store',
  }).end();
}

if (portalOrigin) {
  let target;
  try {
    target = new URL(portalOrigin);
  } catch {
    throw new Error('HRM_DEV_PORTAL_ORIGIN 格式錯誤，請填 develop Portal 的 HTTPS 網址。');
  }
  if (target.protocol !== 'https:' || target.username || target.password || target.href !== target.origin + '/') {
    throw new Error('HRM_DEV_PORTAL_ORIGIN 請填 develop Portal 的 HTTPS 網址，網址後方不用加路徑。');
  }

  proxyConfig['^/(auth/hrm-dev/(login|callback)|api/hrm/(access|employees))(?=[?]|$)'] = {
    target: target.origin,
    changeOrigin: true,
    timeout: 15000,
    proxyTimeout: 15000,
    configure(proxy) {
      proxy.on('proxyReq', (proxyRequest, request) => {
        const cookie = request.headers.cookie?.split(/; +/).find((entry) => entry.startsWith(localCookie + '='));
        proxyRequest.removeHeader('cookie');
        if (cookie) {
          proxyRequest.setHeader('cookie', portalCookie + cookie.slice(localCookie.length));
        }
      });
      proxy.on('error', (_error, request, response) => {
        if (response.headersSent || response.writableEnded) return;
        if (isSignIn(request)) {
          returnToHrm(response, 'unavailable');
        } else {
          response.writeHead(502, { 'Cache-Control': 'no-store' }).end();
        }
      });
      proxy.on('proxyRes', (response, request, browserResponse) => {
        if (isSignIn(request) && (response.statusCode === 404 || response.statusCode >= 500)) {
          returnToHrm(browserResponse, response.statusCode === 404 ? 'not-enabled' : 'unavailable');
          response.resume();
          return;
        }
        const cookies = response.headers['set-cookie'];
        delete response.headers['set-cookie'];
        const sessionCookie = cookies?.find((cookie) => cookie.startsWith(portalCookie + '='));
        if (sessionCookie) {
          // The browser reaches the Angular dev server over HTTP on localhost.
          response.headers['set-cookie'] = [
            localCookie + sessionCookie.slice(portalCookie.length).replace(/; Secure(?=;|$)/i, ''),
          ];
        }
      });
    },
  };
}

export default proxyConfig;
