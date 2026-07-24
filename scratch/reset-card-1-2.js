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

console.log('Resetting content ID 23 and 24 to pending...');
fetch('https://betbudnsetunpmdhjipo.supabase.co/rest/v1/contents?id=in.(23,24)', {
  method: 'PATCH',
  headers: {
    'apikey': serviceKey,
    'Authorization': 'Bearer ' + serviceKey,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  },
  body: JSON.stringify({
    summary_status: 'pending',
    summary: null,
    summary_at: null
  })
})
.then(res => res.json())
.then(data => console.log('Reset result:', JSON.stringify(data, null, 2)))
.catch(err => console.error('Error:', err));
