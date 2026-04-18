const fs = require('fs');
const lockfile = require('proper-lockfile');

async function test() {
  fs.writeFileSync('dummy.json', '{}');
  const release = await lockfile.lock('dummy.json', { retries: 5 });
  console.log('Locked');
  await release();
  console.log('Unlocked');
}
test().catch(console.error);
