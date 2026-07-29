/**
 * Commit vercel.json rewrite rules to 1e0h/syslux-tech-portfolio repository.
 */
const { execSync } = require('child_process');

// Replace this with your actual Vercel deployment URL for logo-extractor
const TARGET_VERCEL_URL = 'https://logo-extractor-omega.vercel.app';

async function main() {
  const token = execSync('"C:\\Program Files\\GitHub CLI\\gh.exe" auth token', { encoding: 'utf8' }).trim();
  const repoOwner = '1e0h';
  const repoName = 'syslux-tech-portfolio';

  const vercelConfig = {
    "rewrites": [
      {
        "source": "/logo-extractor/api/:path*",
        "destination": `${TARGET_VERCEL_URL}/api/:path*`
      },
      {
        "source": "/logo-extractor",
        "destination": `${TARGET_VERCEL_URL}/`
      },
      {
        "source": "/logo-extractor/:path*",
        "destination": `${TARGET_VERCEL_URL}/:path*`
      }
    ]
  };

  const contentBase64 = Buffer.from(JSON.stringify(vercelConfig, null, 2)).toString('base64');

  // Check if vercel.json exists to get sha if updating
  let sha = undefined;
  try {
    const checkRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/vercel.json`, {
      headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'Node' }
    });
    if (checkRes.ok) {
      const data = await checkRes.json();
      sha = data.sha;
    }
  } catch {
    // File doesn't exist yet
  }

  const putRes = await fetch(`https://api.github.com/repos/${repoOwner}/${repoName}/contents/vercel.json`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${token}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'User-Agent': 'Node'
    },
    body: JSON.stringify({
      message: 'Add Vercel rewrite rules for /logo-extractor',
      content: contentBase64,
      sha: sha
    })
  });

  const putData = await putRes.json();
  if (putRes.ok) {
    console.log(`✅ Successfully added vercel.json to ${repoOwner}/${repoName}!`);
    console.log(`Commit URL: ${putData.commit.html_url}`);
  } else {
    console.error(`❌ Failed to update vercel.json: ${putData.message}`);
  }
}

main().catch(console.error);
