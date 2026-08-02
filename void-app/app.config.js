const base = require('./app.json');

// Set VOID_PROXY_BASE at build/start time (for example, your HTTPS deployment
// URL). Keeping it out of source avoids hard-coding a localhost address that
// cannot work from a physical phone.
const configuredBase = process.env.VOID_PROXY_BASE || base.expo.extra?.voidProxyBase || '';

module.exports = {
  ...base.expo,
  extra: {
    ...base.expo.extra,
    voidProxyBase: configuredBase.replace(/\/$/, ''),
  },
};
