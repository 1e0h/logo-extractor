const { execSync } = require('child_process');

async function main() {
  const token = execSync('"C:\\Program Files\\GitHub CLI\\gh.exe" auth token', { encoding: 'utf8' }).trim();
  const res = await fetch('https://api.github.com/repos/1e0h/logo-extractor/contents/public/index.html', {
    headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Node' }
  });
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  console.log('GitHub public/index.html contains syslux-tech.com:', content.includes('syslux-tech.com'));
}

main().catch(console.error);
