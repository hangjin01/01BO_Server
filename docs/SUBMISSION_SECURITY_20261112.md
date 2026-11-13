# 제출 전 보안·성능 보강 — 2026-11-12

## 범위와 기준

프런트, Android 및 별도 `01BO_Server`의 현재 main을 기준으로 수정했다. 완전한 침투 테스트나 무취약점 인증을 의미하지 않는다. 실제 사용자 데이터를 변경하지 않았고 Google/AI 유료 호출 및 메일 발송은 하지 않았다.

앱 버전은 사용자 지정 버그 수정 규칙에 따라 **v0.321**, Android versionCode **8**이다. 정식 출시 v1.0과 구분한다.

## 프런트·Android 변경

| 항목 | 변경 내용 | 이유 |
| --- | --- | --- |
| 의존성 | 호환 범위의 보안 패치, 미사용 `@google/genai` 제거 | 사용하지 않는 클라이언트 AI SDK와 알려진 취약 코드 감소 |
| Tailwind | CDN 실행 스크립트를 제거하고 로컬 PostCSS 빌드 | 실행 때 외부 CSS 생성 코드에 의존하지 않음 |
| import map | 사용하지 않는 외부 esm.sh import map 제거 | Vite 번들로 의존성 일원화 |
| 개인정보 캐시 | 프로필을 localStorage에 저장하지 않고 과거 값 제거 | 이메일/이름의 불필요한 영구 복사 제거 |
| 화면 분할 | 일정·일보·설정·관리자·스캐너·출장 생성 lazy loading | 초기 JS 부담 감소 |
| 공유 링크 | Google 지도 새 창에 noopener/noreferrer 적용 | 새 창의 opener 접근과 referrer 전송 제한 |
| 위치 계산 | 부동소수점 범위를 clamp한 값으로 거리 계산 | 반대편 좌표 부근 NaN 방지 |
| Android 백업 | allowBackup=false 및 cloud/device-transfer 제외 | 세션·리포트가 자동 백업/기기 이전에 포함되지 않도록 제한 |
| Android 통신 | usesCleartextTraffic=false | 앱의 평문 HTTP 제한 |
| FileProvider | 외부 저장소 전체 대신 앱 Pictures 경로만 허용 | 카메라 공유 범위 축소; 캐시는 Word/이미지 공유에 필요 |
| 주석 | 세션·NFC 취소·영수증·HTML escaping·지연 로딩 | 보안 경계와 비동기 처리 이유 설명 |

기존 Markdown 표시 경로는 escape 후 고정 마크업을 적용한다. 위치 정보는 등록 동작과 명시적 경로 요청에서 사용하며, 이번 변경에서 백그라운드 위치 추적을 추가하지 않았다.

## 백엔드 변경

- npm 취약점 패치와 미사용 MySQL 클라이언트 제거.
- 전체 API/AI/로그인/가입 제한기의 메모리 크기를 제한. 활성 키를 임의 퇴출해 할당량이 초기화되지 않게 신규 키를 거부한다.
- API 요청 제한을 대용량 본문 파싱보다 먼저 실행한다.
- 쓰기 요청은 JSON Content-Type 필수. 단순 폼 요청으로 쿠키 기반 상태를 변경하는 경로를 막는다.
- 압축 요청 본문은 받지 않는다. 기존 OCR JSON 크기 한도 15MB는 유지한다.
- Referrer-Policy, X-Frame-Options, CSP, 신뢰된 HTTPS에서 HSTS를 추가한다.
- JSON 파싱 오류에 들어 있는 요청 본문과 DB 제약조건 내부 이름을 응답에서 제거한다. 의도적인 사용자 안내 오류만 expose 표시로 전달한다.
- 회사 소속/소유권, NFC 챌린지, 메일 중복 발송 방지, DB 재시도 범위에 설명 주석을 추가한다.
- `npm test`에 운영 DB·실메일을 쓰지 않는 모의/로컬 테스트 묶음을 등록한다.
- 프런트 저장소의 참고용 backend 사본에도 동일한 보안 변경을 반영했다. 실제 서버 기준은 별도 저장소이다.

## 배포 파일 보강

별도 백엔드 저장소의 Dockerfile은 Oracle Thin 모드용 Node 20 이미지, 고정 잠금 의존성, 비root 사용자와 healthcheck로 변경했다. 더 이상 Instant Client RPM을 요구하지 않는다. Compose는 이를 빌드하고 API의 추가 권한을 제거한다. DB 기본 비밀번호를 제거하고 환경값을 필수화했으며, DB 특권 모드 제거와 1521 loopback 바인딩을 지정했다. Google/AI 등 설정은 필요한 항목만 명시적으로 전달한다.

`.dockerignore`에서 운영 환경파일·비공개 토큰·백업·키를 제외한다. 관리형 에이전트를 사용하려면 운영자가 별도의 비공개 ID 파일 마운트를 준비해야 하며 이미지에는 포함하지 않는다. DB_PASSWORD와 APP_USER_PASSWORD는 같은 DB 계정 비밀번호에 맞춰야 한다.

**위 배포 설정은 현재 AWS에 자동 적용하지 않았다.** 실행 중인 DB 재생성은 중단과 복구 절차를 준비한 후 별도로 해야 한다.

## 검증 결과

- npm audit: 프런트 **18 → 0**, 백엔드 **4 → 0** (2026-11-12 기준). 알려진 패키지 advisory 검사일 뿐 전체 코드 무취약점 보장이 아니다.
- TypeScript, 프런트 회귀, NFC 순서/취소, 도로 경로, 카메라 모의 검사 통과.
- 서버 입력 단위, Gmail 암호화/PKCE, OpenAI/관리형 어댑터 모의, 프록시/CORS, 새 request-security 검사 통과.
- Vite production build 통과. 초기 JS 묶음은 기존 약 588KB에서 **363.06KB**(gzip 113.51KB). 지연 청크를 포함한 전체 코드 크기를 이 수치로 설명하지 않는다.
- 기존 혼합 static/dynamic import 경고를 정리했고 최종 Vite 빌드에는 해당 경고가 없다.
- 로컬 브라우저 로그인 화면의 스타일 확인. 실제 로그인/가입은 이번 UI 점검에서 실행하지 않았다.
- Android assembleDebug, testDebugUnitTest 통과. 병합된 Manifest에서 백업/평문 금지 설정 확인.
- 추적된 텍스트 파일의 API 키/개인키 패턴 검사에서 후보 없음. 모든 Git 과거 이력과 외부 비밀 관리 시스템을 전수 감사한 것은 아니다.
- 로컬 Docker CLI는 Podman SQLite 공유 라이브러리 오류로 실행 불가. 새 Docker 이미지 build/compose 통합 실행은 미검증이다.

## 운영 서버 읽기 전용 확인

주소 `57.183.24.179`의 `/health`, `/api/health`가 200/DB ready였다. `trip-api`는 host80→3000, `trip-oracle`은 0.0.0.0/IPv6의 1521 포트에 바인딩되어 있다. DB 컨테이너 privileged=true, UFW inactive를 확인했다. **외부 접근 가능 여부는 AWS 보안 그룹/네트워크 규칙을 추가로 봐야 한다.** 이 결과만으로 인터넷에서 DB 접속에 성공했다고 주장하지 않는다.

## 제출 전에 남은 실제 적용·실기기 확인

- [ ] 코드 PR 검토/병합 후 서버 백업, 의존성 설치, API 재시작 및 업무 회귀
- [ ] AWS 보안 그룹 DB 1521 외부 규칙 확인, DB 컨테이너 특권 제거/loopback 전환의 계획된 재생성
- [ ] Docker 이미지 빌드 및 테스트 DB로 compose 전체 검증
- [ ] v0.321 실기기 업데이트 후 로그인·NFC·카메라·Word 공유·Gmail 재확인
- [ ] 관리자 통계/메일 표시 상태 복원, 잔여 일본어 문구 및 실제 음성/OCR 등 기존 미해결 기능
- [ ] 제출이 배포본을 요구하면 debug APK와 별도로 정식 서명·배포 정책 준비

진행 상황을 과장하지 않기 위해 소스 보강, 빌드 성공, 운영 적용, 실기기 검증을 별도 단계로 기록한다.
