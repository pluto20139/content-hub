const fs = require('fs');
const envContent = fs.readFileSync('.env', 'utf8');
let serviceKey = '';
envContent.split('\n').forEach(line => {
  if (line.startsWith('SUPABASE_SERVICE_ROLE_KEY=')) {
    serviceKey = line.split('=')[1].trim();
    if (serviceKey.startsWith('"') && serviceKey.endsWith('"')) serviceKey = serviceKey.slice(1, -1);
    if (serviceKey.startsWith("'") && serviceKey.endsWith("'")) serviceKey = serviceKey.slice(1, -1);
  }
});

console.log('Querying all fields for content ID 26...');
fetch('https://betbudnsetunpmdhjipo.supabase.co/rest/v1/contents?id=eq.26&select=*', {
  headers: {
    'apikey': serviceKey,
    'Authorization': 'Bearer ' + serviceKey
  }
})
.then(res => res.json())
.then(data => console.log('Content 26 fields:', JSON.stringify(data, null, 2)))
.catch(err => console.error('Error:', err));
