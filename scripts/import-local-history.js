const fs = require('node:fs');
const path = require('node:path');
require('../lib/load-env');
const { database, saveMessage } = require('../lib/message-store');

async function main() {
  const filename = process.argv[2] || path.join(__dirname, '..', 'data', 'messages.json');
  const messages = JSON.parse(fs.readFileSync(filename, 'utf8'));
  const pool = database();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const message of messages) await saveMessage(message, client);
    await client.query('COMMIT');
    console.log(`Imported ${messages.length} messages into the shared database.`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(error => {
  console.error(`History import failed: ${error.message}`);
  process.exitCode = 1;
});
