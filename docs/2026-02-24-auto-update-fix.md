# 자동업데이트 버전 감지 오류 수정

**날짜**: 2026-02-24
**버전**: v1.0.5 → v1.0.6

---

## 문제

앱 실행 시 `electron-updater`가 GitHub에서 새 버전을 감지하지 못함.

## 원인 분석

1. **GitHub Release가 Draft 상태**
   `electron-builder --win --publish always`가 릴리즈를 **Draft**로 생성함.
   Draft 릴리즈는 공개 API에서 조회되지 않아 `electron-updater`가 `latest.yml`을 가져올 수 없었음.

2. **기존 릴리즈 없음**
   v1.0.5까지 빌드했지만 모두 Draft 상태로 남아있어 공개된 릴리즈가 0개였음.

## 수정 내용

### 1. `.env.json` 토큰 관리 추가

GH_TOKEN을 프로젝트 내 `.env.json`에서 관리하도록 변경.

- **`.env.json`** (신규, gitignore 등록)
  ```json
  {
    "GH_TOKEN": "ghp_xxx..."
  }
  ```
- **`.gitignore`** — `.env.json` 추가하여 커밋 방지

### 2. `scripts/build.js` — 토큰 자동 로드

환경변수에 `GH_TOKEN`이 없으면 `.env.json`에서 자동으로 읽도록 수정.

```javascript
// 환경변수 → .env.json 순서로 확인
if (!process.env.GH_TOKEN) {
  const envJsonPath = path.join(root, '.env.json');
  if (fs.existsSync(envJsonPath)) {
    const envJson = JSON.parse(fs.readFileSync(envJsonPath, 'utf8'));
    if (envJson.GH_TOKEN) process.env.GH_TOKEN = envJson.GH_TOKEN;
  }
}
```

### 3. `scripts/build.js` — Draft 자동 퍼블리시

빌드 완료 후 GitHub API로 Draft 릴리즈를 자동으로 Published 상태로 전환하는 `publishDraftRelease()` 함수 추가.

**빌드 플로우**:
1. GH_TOKEN 확인 (환경변수 → `.env.json`)
2. 변경 내용 입력
3. 버전 bump (patch +1)
4. CHANGELOG.md 업데이트
5. Git commit & tag & push
6. electron-builder 빌드 & GitHub 업로드
7. **Draft → Published 자동 전환** (신규)
8. 공유 드라이브 복사

### 4. 기존 Draft 릴리즈 퍼블리시

- v1.0.5: Draft → Published
- v1.0.6: Draft → Published

## 변경 파일

| 파일 | 변경 |
|------|------|
| `.gitignore` | `.env.json` 추가 |
| `.env.json` | 신규 생성 (GH_TOKEN 저장, git 추적 제외) |
| `scripts/build.js` | 토큰 자동 로드 + Draft 자동 퍼블리시 |
| `package.json` | 버전 1.0.5 → 1.0.6 |
| `package-lock.json` | 버전 1.0.5 → 1.0.6 |
| `CHANGELOG.md` | v1.0.6 항목 추가 |
