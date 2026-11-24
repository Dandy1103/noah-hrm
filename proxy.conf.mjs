const core = process.env.CORE_URL || '';
const backend = 'http://127.0.0.1:' + (process.env.HRM_BACKEND_PORT || '3001');
const rules = [];

if (core) {
  rules.push(
    { context: ['/auth/login'], target: core, xfwd: true },
    { context: ['/oauth2', '/login', '/api/session', '/api/me'], target: core, xfwd: true },
  );
}

rules.push({ context: ['/auth', '/api'], target: backend });

export default rules;
