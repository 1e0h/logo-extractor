const { execSync } = require('child_process');

async function main() {
  const token = execSync('"C:\\Program Files\\GitHub CLI\\gh.exe" auth token', { encoding: 'utf8' }).trim();
  const res = await fetch('https://api.github.com/repos/1e0h/syslux-tech-portfolio/contents/src', {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Node' }
  });
  const files = await res.json();
  console.log('src/ contents:', files.map(f => f.name));

  // Check App.jsx or App.tsx or main routes
  const appFile = files.find(f => f.name.startsWith('App.'));
  if (appFile) {
    const aRes = await fetch(appFile.download_url);
    console.log(`\nContents of ${appFile.name}:`);
    console.log(await aRes.text());
  }
}

main().catch(console.error);
