import fs from 'fs';
fetch('http://localhost:3000/api/upload', {
  method: 'POST',
  body: new FormData()
}).then(r => r.text()).then(console.log).catch(console.error);
