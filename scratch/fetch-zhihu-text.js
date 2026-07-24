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

console.log('Fetching zhihu content text via article-fetcher...');
fetch('https://betbudnsetunpmdhjipo.supabase.co/functions/v1/article-fetcher', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + serviceKey
  },
  body: JSON.stringify({
    platform: 'zhihu',
    native_id: '2057825134480733807',
    content_type: 'answer'
  })
})
.then(res => res.json())
.then(data => {
  console.log('Error:', data.error);
  if (data.content_text) {
    console.log('Content Text Length:', data.content_text.length);
    console.log('Content Text Preview:', data.content_text);
  }
})
.catch(err => console.error('Error:', err));
