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

console.log('Querying native_id for ID 25...');
fetch('https://betbudnsetunpmdhjipo.supabase.co/rest/v1/contents?id=eq.25&select=native_id', {
  headers: {
    'apikey': serviceKey,
    'Authorization': 'Bearer ' + serviceKey
  }
})
.then(res => res.json())
.then(data => {
  const nativeId = data[0].native_id;
  console.log('Native ID:', nativeId);
  console.log('Fetching zhihu content text via article-fetcher...');
  return fetch('https://betbudnsetunpmdhjipo.supabase.co/functions/v1/article-fetcher', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + serviceKey
    },
    body: JSON.stringify({
      platform: 'zhihu',
      native_id: nativeId,
      content_type: 'answer'
    })
  });
})
.then(res => res.json())
.then(data => {
  if (data.content_text) {
    console.log('Content Text Length:', data.content_text.length);
    console.log('Content Text Preview (first 500 chars):', data.content_text.slice(0, 500));
  } else {
    console.log('Error:', data.error);
  }
})
.catch(err => console.error('Error:', err));
