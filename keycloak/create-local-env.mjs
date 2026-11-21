import { randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const localEnv = new URL('../.env.keycloak', import.meta.url);

const databaseUrl = (password) => `postgresql://noah_hrm:${encodeURIComponent(password)}@127.0.0.1:5434/noah_hrm`;

try {
    const values = { OIDC_CLIENT_ID: 'noah-hrm', OIDC_ISSUER_URL: 'http://localhost:8082/realms/noah-hrm-local' };
    for (const name of ['OIDC_CLIENT_SECRET', 'KC_BOOTSTRAP_ADMIN_PASSWORD', 'KEYCLOAK_DEMO_PASSWORD', 'HRM_DB_PASSWORD']) {
        values[name] = randomBytes(32).toString('hex');
    }
    values.DATABASE_URL = databaseUrl(values.HRM_DB_PASSWORD);
    const entries = Object.entries(values).map(([key, value]) => `${key}=${value}`);
    writeFileSync(localEnv, entries.join('\n') + '\n', { flag: 'wx', mode: 0o600 });
    console.log('Created .env.keycloak.');
} catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const raw = readFileSync(localEnv, 'utf8');
    const values = parseEnv(raw);
    const password = values.HRM_DB_PASSWORD || randomBytes(32).toString('hex');
    const additions = {
        HRM_DB_PASSWORD: password,
        DATABASE_URL: databaseUrl(password)
    };
    let updated = raw;
    for (const [key, value] of Object.entries(additions)) {
        if (values[key]) continue;
        const line = new RegExp(`^${key}=[^\\r\\n]*`, 'm');
        updated = line.test(updated)
            ? updated.replace(line, () => `${key}=${value}`)
            : updated.trimEnd() + `\n${key}=${value}\n`;
    }
    if (updated !== raw) writeFileSync(localEnv, updated);
    console.log('Using the existing .env.keycloak with local database settings.');
}
