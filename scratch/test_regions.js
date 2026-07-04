const postgres = require('postgres');

const regions = [
  'ap-southeast-1', // Singapore (highly likely for Asian users)
  'us-west-1',      // Oregon
  'us-east-1',      // N. Virginia
  'eu-west-3',      // Paris
  'eu-central-1',   // Frankfurt
  'ap-northeast-1', // Tokyo
  'ap-northeast-2', // Seoul
  'us-west-2'       // California
];

async function testRegions() {
  for (const region of regions) {
    const host = `aws-0-${region}.pooler.supabase.com`;
    console.log(`Testing region ${region} (${host})...`);
    const sql = postgres({
      host: host,
      port: 6543,
      database: 'postgres',
      username: 'postgres.betbudnsetunpmdhjipo',
      password: 'Lr15607061996',
      ssl: 'require',
      connect_timeout: 3
    });

    try {
      await sql`SELECT 1`;
      console.log(`✅ Success! Correct region is: ${region}`);
      await sql.end();
      process.exit(0);
    } catch (err) {
      console.log(`❌ Failed for ${region}:`, err.message.trim());
    } finally {
      await sql.end();
    }
  }
  console.log('Could not find any matching region.');
}

testRegions();
