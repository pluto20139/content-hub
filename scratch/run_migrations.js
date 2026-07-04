const postgres = require('postgres');
const fs = require('fs');

// Read the combined migrations SQL from the same folder
const sqlContent = fs.readFileSync('./combined_migrations.sql', 'utf8');

const sql = postgres({
  host: 'aws-0-ap-southeast-1.pooler.supabase.com',
  port: 6543,
  database: 'postgres',
  username: 'postgres.betbudnsetunpmdhjipo',
  password: 'Lr15607061996',
  ssl: 'require'
});

async function main() {
  try {
    console.log('Connecting to Supabase Singapore Pooler on port 6543 (IPv4)...');
    await sql.unsafe(sqlContent);
    console.log('🎉 Database migrated successfully!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    console.error(err);
  } finally {
    await sql.end();
  }
}

main();
