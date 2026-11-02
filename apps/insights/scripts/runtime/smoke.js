require('../../src/shared/env');
for (const modulePath of [
  './observe',
  './detect',
  './export',
  '../../src/tarc/bus/adherence',
  '../../src/tarc/bus/cancellations',
  '../../src/tarc/shared/delivery',
])
  require(modulePath);
console.log('TARC production pipeline imports resolved');
