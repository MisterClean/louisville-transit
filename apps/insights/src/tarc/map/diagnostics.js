const { AsyncLocalStorage } = require('node:async_hooks');
const renders = new AsyncLocalStorage();

// Classify without ever returning raw browser/provider text (URLs carry keys).
function errorCode(error) {
  if (
    [
      'provider_auth',
      'provider_rate_limit',
      'provider_resource',
      'browser_crash',
      'render_timeout',
      'disk_full',
      'shape_unavailable',
      'render_failed',
    ].includes(error?.code)
  )
    return error.code;
  const message = String(error?.message || '');
  if (/401|403/.test(message)) return 'provider_auth';
  if (/429/.test(message)) return 'provider_rate_limit';
  if (/resource failed|http_5\d\d/.test(message)) return 'provider_resource';
  if (/crash|Target closed|browser.*closed/i.test(message)) return 'browser_crash';
  if (/timeout|timed out/i.test(message)) return 'render_timeout';
  if (/ENOSPC|disk.*full/i.test(message)) return 'disk_full';
  if (/shape unavailable/i.test(message)) return 'shape_unavailable';
  return 'render_failed';
}
function recordBasemap(basemap, error = null) {
  const state = renders.getStore();
  if (state) {
    if (state.basemap !== 'degraded') state.basemap = basemap;
    if (error) state.error = error;
  }
}
async function withRenderDiagnostics(render) {
  const state = { basemap: null, error: null };
  return renders.run(state, async () => ({ value: await render(), ...state }));
}
module.exports = { errorCode, recordBasemap, withRenderDiagnostics };
