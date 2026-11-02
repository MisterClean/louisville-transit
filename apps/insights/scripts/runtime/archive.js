require('../../src/shared/env');
const Path = require('node:path');
const storage = require('../../src/tarc/storage');
const { archive } = require('../../src/tarc/positionsPublication');
async function run(options = {}) {
  const stateDir =
    process.env.TRANSIT_STATE_DIR ||
    Path.dirname(
      process.env.TARC_HISTORY_DB_PATH || Path.join(__dirname, '../../state/tarc.sqlite'),
    );
  return archive({
    db: storage.getDb(),
    outDir: Path.join(process.env.TRANSIT_WEB_DIR || Path.join(stateDir, '../web'), 'positions'),
    manifestPath: Path.join(stateDir, 'positions-manifest.json'),
    limit: Number(process.env.TRANSIT_ARCHIVE_DAY_LIMIT || 3),
    ...options,
  });
}
if (require.main === module)
  run()
    .then((result) => console.log(JSON.stringify(result)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(() => storage.closeDb());
module.exports = { run };
