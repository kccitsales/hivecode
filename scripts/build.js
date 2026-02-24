const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');
const { execSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const pkgPath = path.join(root, 'package.json');
const lockPath = path.join(root, 'package-lock.json');
const changelogPath = path.join(root, 'CHANGELOG.md');

function prompt(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer); }));
}

async function main() {

// 0. Check GH_TOKEN (환경변수 → .env.json 순서로 확인)
if (!process.env.GH_TOKEN) {
  const envJsonPath = path.join(root, '.env.json');
  if (fs.existsSync(envJsonPath)) {
    const envJson = JSON.parse(fs.readFileSync(envJsonPath, 'utf8'));
    if (envJson.GH_TOKEN) {
      process.env.GH_TOKEN = envJson.GH_TOKEN;
      console.log('GH_TOKEN loaded from .env.json');
    }
  }
}
if (!process.env.GH_TOKEN) {
  console.error('GH_TOKEN을 찾을 수 없습니다.');
  console.error('다음 중 하나로 설정해주세요:');
  console.error('  1. .env.json 파일: { "GH_TOKEN": "your_token" }');
  console.error('  2. 환경변수: set GH_TOKEN=your_token');
  process.exit(1);
}

// 1. Collect changelog messages
const messages = [];
console.log('변경 내용을 입력하세요 (빈 줄 입력 시 완료):');
while (true) {
  const line = await prompt('- ');
  if (!line.trim()) break;
  messages.push(line.trim());
}

if (messages.length === 0) {
  console.log('변경 내용이 없습니다. 빌드를 취소합니다.');
  process.exit(1);
}

// 2. Read & bump patch version
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);
const newVersion = `${major}.${minor}.${patch + 1}`;
pkg.version = newVersion;
fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf8');

// Update package-lock.json version too
if (fs.existsSync(lockPath)) {
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  lock.version = newVersion;
  if (lock.packages && lock.packages['']) {
    lock.packages[''].version = newVersion;
  }
  fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf8');
}

// 3. Build date
const now = new Date();
const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

// 4. Prepend changelog entry
const items = messages.map(m => `- ${m}`).join('\n');
const entry = `## v${newVersion} (${date})\n\n${items}\n`;

let existing = '';
if (fs.existsSync(changelogPath)) {
  existing = fs.readFileSync(changelogPath, 'utf8');
  existing = existing.replace(/^# CHANGELOG\n\n/, '');
}

const changelog = `# CHANGELOG\n\n${entry}\n${existing}`;
fs.writeFileSync(changelogPath, changelog, 'utf8');

console.log(`\nVersion bumped: ${major}.${minor}.${patch} -> ${newVersion}`);
console.log(`CHANGELOG.md updated`);

// 5. Git commit & tag
console.log('\nCommitting version bump...');
execSync('git add -A', { cwd: root, stdio: 'inherit' });
execSync(`git commit -m "v${newVersion}"`, { cwd: root, stdio: 'inherit' });
execSync(`git tag v${newVersion}`, { cwd: root, stdio: 'inherit' });
execSync('git push && git push --tags', { cwd: root, stdio: 'inherit' });
console.log(`Tag v${newVersion} pushed to GitHub`);

// 6. Run electron-builder + publish to GitHub Releases
console.log('\nBuilding & publishing to GitHub Releases...\n');
execSync('npx electron-builder --win --publish always', { cwd: root, stdio: 'inherit' });

// 7. Publish draft release on GitHub
console.log('\nPublishing GitHub Release draft...');
await publishDraftRelease(newVersion);

console.log(`\n=== v${newVersion} 빌드 & GitHub Release 완료 ===`);

} // end main

function publishDraftRelease(version) {
  return new Promise((resolve, reject) => {
    const token = process.env.GH_TOKEN;
    const listOptions = {
      hostname: 'api.github.com',
      path: '/repos/kccitsales/hivecode/releases',
      method: 'GET',
      headers: {
        'Authorization': `token ${token}`,
        'User-Agent': 'hivecode-build',
      }
    };

    https.get(listOptions, (res) => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        const releases = JSON.parse(body);
        const draft = releases.find(r => r.tag_name === `v${version}` && r.draft);
        if (!draft) {
          console.log(`  v${version} 릴리즈가 이미 published 상태이거나 찾을 수 없습니다.`);
          return resolve();
        }

        const data = JSON.stringify({ draft: false, tag_name: `v${version}`, make_latest: 'true' });
        const patchOptions = {
          hostname: 'api.github.com',
          path: `/repos/kccitsales/hivecode/releases/${draft.id}`,
          method: 'PATCH',
          headers: {
            'Authorization': `token ${token}`,
            'Content-Type': 'application/json',
            'User-Agent': 'hivecode-build',
            'Content-Length': Buffer.byteLength(data),
          }
        };

        const req = https.request(patchOptions, (res2) => {
          let body2 = '';
          res2.on('data', d => body2 += d);
          res2.on('end', () => {
            const result = JSON.parse(body2);
            if (result.draft === false) {
              console.log(`  v${version} 릴리즈 published 완료! (${result.published_at})`);
            } else {
              console.error(`  v${version} 릴리즈 publish 실패:`, result.message || 'unknown error');
            }
            resolve();
          });
        });
        req.on('error', (e) => { console.error('  Publish 요청 실패:', e.message); resolve(); });
        req.write(data);
        req.end();
      });
    }).on('error', (e) => { console.error('  릴리즈 목록 조회 실패:', e.message); resolve(); });
  });
}

main();
