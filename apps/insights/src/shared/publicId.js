const crypto = require('node:crypto');
// Public event IDs also become filenames. Keep ordinary source IDs stable;
// hash path syntax, control characters, dot entries, and overlong source IDs.
function publicEventId(value) {
  const id = String(value);
  return id.length <= 180 && /^[A-Za-z0-9_.-]+$/.test(id) && id !== '.' && id !== '..'
    ? id
    : `event-${crypto.createHash('sha256').update(id).digest('hex').slice(0, 32)}`;
}
module.exports = { publicEventId };
