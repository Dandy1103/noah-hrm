const { withNativeFederation, shareAll } = require('@angular-architects/native-federation/config');
const { resolve } = require('node:path');

const localUi = process.env.NOAH_UI_LOCAL === '1';
const shared = shareAll({ singleton: true, strictVersion: true, requiredVersion: 'auto' });
const skip = [
  'rxjs/ajax',
  'rxjs/fetch',
  'rxjs/testing',
  'rxjs/webSocket',
];

if (localUi) {
  skip.push('@dandy1103/common', '@dandy1103/ui');
}

const config = withNativeFederation({
  name: 'noah-hrm',
  exposes: {
    './routes': './src/app/remote.routes.ts',
  },
  shared,
  skip,
});

if (localUi) {
  // Federation builds this source mapping separately from the Shell's npm package.
  config.sharedMappings.push({
    key: '@dandy1103/common',
    path: resolve(__dirname, '../noah-common/projects/common/src/public-api.ts'),
  });
}

module.exports = config;
