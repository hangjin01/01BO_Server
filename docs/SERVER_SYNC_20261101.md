# v0.32 운영 백엔드 소스 반영

## 출처와 범위

- 확인일: 2026-11-01
- AWS 연결 주소: `57.183.24.179`
- 실행 컨테이너: `trip-api`, 이미지 `node:20-alpine`
- 실제 바인드 마운트: `/home/ubuntu/japan-trip-app/backend` → `/app`
- 호스트 포트 `80` → 컨테이너 `3000`
- API 주소: `https://api.01bo.cloud/api`

서버의 `/home/ubuntu/01BO_Server` 폴더가 아닌 실제 컨테이너 마운트에서 51개 소스 파일을 가져왔다. 파일별 SHA-256은 `server-source-sha256-20261101.json`에 기록했다. 이 목록의 파일 내용은 가져온 원본과 일치한다. 운영 서비스 재시작, 배포, DB 마이그레이션, 데이터 변경은 수행하지 않았다.

## 반영 기능

- Express 서버, CORS·신뢰 프록시·요청 제한·오류 처리
- `/health`의 인증·DB 쿼리 없는 응답과 `/api/health`의 DB 준비 상태 검사. 단, 프로세스 최초 시작은 DB 풀 초기화를 기다린다.
- Oracle 연결 풀 준비 확인과 일시적 장애 처리. 업무 쓰기나 트랜잭션 자체를 자동 재실행하지 않는다.
- 비밀번호 인증·세션, 회사 생성·초대·가입 및 회사/사용자 접근 범위 처리
- 출장·일정·방문·경비·일보 및 작업 흐름 라우트
- 제로보 요청 해석, 도구 작업 처리, OpenAI Responses/관리형 에이전트 어댑터 및 설정
- 장소 검색, 일보 텍스트와 Word 생성
- Gmail OAuth, PKCE, 일회성 상태 검증, 암호화 토큰 및 메일 발송
- NFC 등록·챌린지·GPS 현장 확인
- 스키마 마이그레이션·테스트 스크립트

## 제외한 자료와 실행 설정

`.env` 및 비공개 설정, `.private`, `.backups`, `.releases`, 이전 코드 사본, DB 데이터, `node_modules`, Oracle RPM은 가져오지 않았다. 실제 운영 Compose 환경도 복사하지 않았다. 기존 저장소의 Compose/Dockerfile은 그대로 보존한 초기 구성으로, 현재 운영 환경 전체를 재현하는 파일이 아니다.

특히 기존 Compose에는 예제 DB 비밀번호 기본값과 외부 DB 포트 노출 설정이 있고, Gmail·AI 환경변수 전달 설정은 없다. 기존 Dockerfile은 Git에 없는 `instantclient.rpm`을 요구한다. 현재 서버는 이 Dockerfile 빌드 이미지가 아니라 `node:20-alpine` 바인드 마운트를 사용한다. 그대로 새 서버에 배포할 수 있다고 해석하면 안 된다.

`npm ci`로 의존성을 설치하고 환경변수를 주입한 뒤 `node server.js`로 실행한다. 코드 자체는 `.env`를 자동 로드하지 않는다. DB 설정은 `DB_USER`, `DB_PASSWORD`, `DB_CONNECT_STRING`이다. 운영 환경에서는 다음 항목도 별도로 구성해야 한다.

- `ALLOWED_ORIGINS`, 실제 프록시 대역에 한정한 `TRUSTED_PROXY_CIDRS`
- `OPENAI_API_KEY`, `OPENAI_MODEL`, `O1BO_AGENT_MODE` 및 선택적 `O1BO_AGENT_ID_FILE`
- `O1BO_GOOGLE_CLIENT_ID`, `O1BO_GOOGLE_CLIENT_SECRET`, `O1BO_GOOGLE_REDIRECT_URI`, `O1BO_TOKEN_KEY`
- `O1BO_GEOCODER_URL`, `O1BO_GEOCODER_USER_AGENT`

Gmail 운영 리디렉션은 `https://api.01bo.cloud/api/gmail/callback`이다. 기존 토큰 암호화 키를 새 값으로 교체하면 기존 암호문을 읽지 못하므로 운영 키를 임의 재생성하지 않는다. 관리형 에이전트 ID 및 세션 자료는 비공개 설정에서 별도로 준비해야 한다. 설정 JSON에 있는 모델명은 서버에서 가져온 값이며 모델 제공 여부를 이번 작업에서 호출해 검증하지 않았다.

마이그레이션과 시드 스크립트는 DB를 변경하므로 이번 작업에서는 실행하지 않았다. `npm test`는 아직 기본 실패 스크립트다. 개별 검증 파일을 직접 실행해야 한다.

## 이번 검증

- 가져온 51개 파일 원본 대조 통과
- JavaScript 45개 파일 `node --check` 통과
- `node tests/unit.js` 통과
- `node tests/gmail.js` 통과: 모의 OAuth/DB, 실제 Google 호출·메일 발송 없음
- `node tests/openai.js` 통과: 모의 응답, 실제 API 호출 없음
- `node tests/managed-agent.js` 통과: 모의 관리형 세션
- `node tests/proxy.js` 통과: 로컬 HTTP 서버에서 신뢰 프록시/CORS 확인
- 비밀값 패턴 검사: 테스트용 가짜 값 외 신규 후보 없음

전체 DB 통합 테스트, 실메일, 실제 AI 모델 호출 및 NFC 실기기 검증은 이번 소스 반영에서 수행하지 않았다.

## 의존성과 알려진 후속 작업

`npm ci --ignore-scripts` 후 npm audit에서 4건이 보고되었다. 운영 소스 및 잠금 파일을 그대로 보존하기 위해 이번 반영에서는 패키지를 변경하지 않았다.

| 패키지 | 심각도 | 후속 작업 |
| --- | --- | --- |
| proxy-addr | critical | 신뢰 프록시/IP 우회 관련 패치 적용 및 프록시 회귀 검사 |
| body-parser | high | 압축 요청 DoS 관련 패치 적용 |
| nodemailer | moderate | 주소 파싱·SMTP 관련 패치 적용 및 수신자/발송 검사 |
| qs | moderate | 파싱·직렬화 관련 패치 적용 |

패키지 업그레이드는 별도 변경으로 검증 후 배포해야 한다. 관리자 통계의 실제 기록 반영, 발송 후 채팅 상태 복원 문제 역시 이번 소스 복사로 해결됐다고 주장하지 않는다. 프런트엔드 PR: https://github.com/hangjin01/01BO/pull/1
