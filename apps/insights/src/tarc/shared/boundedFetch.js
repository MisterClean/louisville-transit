// Bound remote JSON before SDK schema validation. The publisher only needs
// small session, record and upload-status responses, never unbounded feeds.
const MAX_BYTES = 256 * 1024;
const MAX_NODES = 10000;
function validateJsonSize(value, depth = 0, budget = { left: MAX_NODES }) {
  if (--budget.left < 0 || depth > 30) throw new Error('Social response exceeds structural limits');
  if (value && typeof value === 'object') {
    const items = Array.isArray(value) ? value : Object.values(value);
    if (items.length > 1000) throw new Error('Social response collection is too large');
    for (const item of items) validateJsonSize(item, depth + 1, budget);
  }
}
async function boundedFetch(input, init = {}, { maxBytes = MAX_BYTES } = {}) {
  const timeout = AbortSignal.timeout(30000);
  const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  const response = await fetch(input, { ...init, signal });
  if (!response.body) return response;
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('Social response exceeds byte limit');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  }
  const bytes = Buffer.concat(chunks);
  if (response.headers.get('content-type')?.includes('json'))
    validateJsonSize(JSON.parse(bytes.toString('utf8')));
  return new Response(bytes, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
module.exports = { boundedFetch, validateJsonSize };
