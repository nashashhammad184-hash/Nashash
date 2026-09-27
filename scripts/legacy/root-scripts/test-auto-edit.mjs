import http from 'http';

function request(url, options, data) {
  return new Promise((resolve, reject) => {
    const req = http.request(url, options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

async function runTest() {
  try {
    // 1. Get real projects from DB
    const projectsRes = await request('http://localhost:5000/api/projects', { method: 'GET' });
    const projectsData = JSON.parse(projectsRes.body);

    if (!projectsData.projects || projectsData.projects.length === 0) {
      console.log('STATUS: 400');
      console.log('RESPONSE: {"error":"No real projects exist in DB to test Auto Edit"}');
      return;
    }

    const realProjectId = projectsData.projects[0].id;

    // 2. Test Auto Edit on a real project ID
    const autoEditRes = await request(`http://localhost:5000/api/projects/${realProjectId}/auto-edit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    });

    console.log(`STATUS: ${autoEditRes.status}`);
    console.log(`RESPONSE: ${autoEditRes.body}`);
  } catch (err) {
    console.error('EXECUTION ERROR:', err.message);
  }
}

runTest();
