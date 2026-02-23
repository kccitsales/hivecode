const fs = require('fs');
const path = require('path');
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

// 4. Run electron-builder
console.log('\nBuilding...\n');
execSync('npx electron-builder --win', { cwd: root, stdio: 'inherit' });

// 5. Copy installer to shared drive
const copyDest = String.raw`Y:\IT영업_물류팀(KKA0116A0)\006.운영문서\최원영\HiveCode`;
const distDir = path.join(root, 'dist');

try {
  const installer = fs.readdirSync(distDir).find(f => f.endsWith('.exe') && f.includes(newVersion));
  if (installer) {
    const src = path.join(distDir, installer);
    const dest = path.join(copyDest, installer);
    fs.copyFileSync(src, dest);
    console.log(`\nCopied ${installer} -> ${copyDest}`);
  } else {
    console.warn('\nWarning: installer .exe not found in dist/');
  }
} catch (e) {
  console.error(`\nFailed to copy to shared drive: ${e.message}`);
}

} // end main
main();
