require('dotenv').config();
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

// one-time setup script, run via `npm run init-db`. the server itself never touches this
async function init() {
  // no `database` option since it might not exist yet. connect first, then create it below
  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'studymind',
    password: process.env.DB_PASSWORD || '',
    port: process.env.DB_PORT || 3306,
    multipleStatements: true,
  });

  const dbName = process.env.DB_NAME || 'studymind';
  await connection.query(
    `CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await connection.query(`USE \`${dbName}\``);

  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
  await connection.query(schema);

  console.log(`Database "${dbName}" initialized.`);
  await connection.end();
}

init().catch((err) => {
  console.error('DB init failed:', err);
  process.exit(1);
});
