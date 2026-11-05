const fs = require('node:fs');
const path = require('node:path');
require('../lib/load-env');
const { Pool } = require('pg');

async function main() {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
  const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL_UNPOOLED or DATABASE_URL in .env.');
  const pool = new Pool({ connectionString, max: 1 });
  await pool.query(sql);
  await pool.end();
  console.log('Database schema is ready.');
}

main().catch(error => {
  console.error(`Database migration failed: ${error.message}`);
  process.exitCode = 1;
});
