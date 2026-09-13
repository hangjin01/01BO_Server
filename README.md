# 01BO_Server 🚀

**01BO_Server**는 멀티테넌시(Multi-Tenancy) 아키텍처 기반의 출장 관리, GPS/NFC 기반 체크인 검증, 경비 정산 및 인보이스 자동화를 제공하는 백엔드 REST API 운영 서버입니다.

---

## 📌 1. 프로젝트 개요 (Overview)

- **서비스명**: 01BO Server (백엔드 API 및 데이터베이스 서비스)
- **주요 기능**:
  - **Multi-Tenancy 지원**: 테넌트(회사 `COMPANY_CODE`)별 완벽한 논리적 데이터 격리 및 통계 집계
  - **출장(Trip) 및 일정 관리**: 출장 신청, 일정 JSON 파싱, 상태 변경 및 출장 보고서 관리
  - **GPS / NFC 체크인 검증**: 위치(위도/경도) 및 NFC 태깅 기반의 출장지 방문 인증 기능 (`CHECK_INS`)
  - **경비 정산 (Expenses)**: 출장 관련 경비 영수증 등록, 가맹점/카테고리별 분류 및 자동 환율 계산
  - **보안 및 운영 분리**: 보안 민감정보(비밀번호, API 키 등)는 `.env` 환경 변수로 격리하여 관리

---

## 🏗️ 2. 기술 스택 및 디렉토리 구조 (Tech Stack & Architecture)

### 🛠 Tech Stack
- **Runtime & Framework**: Node.js (v18+) / Express.js (v5.x)
- **Database**: Oracle Database 21c XE / 18c (Node-oracledb Thin Mode v6+)
- **Container Infrastructure**: Docker & Docker Compose
- **Security & Data Isolation**: Row-Level Multi-Tenancy (`COMPANY_CODE` 필터링 및 복합 인덱싱)

### 📁 Directory Structure
```text
01BO_Server/
├── backend/
│   ├── routes/                # API 엔드포인트 라우터
│   │   ├── checkins.js        # GPS/NFC 체크인 관련 API
│   │   ├── companies.js       # 테넌트/회사 관리 API
│   │   ├── expenses.js        # 경비 정산 관련 API
│   │   ├── trips.js           # 출장 일정 및 보고서 API
│   │   └── users.js           # 사용자 계정 관리 API
│   ├── db.js                  # Oracle DB Connection Pool 설정
│   ├── migrate_multitenancy.js # 멀티테넌시 DB 마이그레이션 스크립트
│   ├── seed_data.js           # 초기 테스트/시드 데이터 생성 스크립트
│   ├── server.js              # Express 메인 서버 파일
│   ├── Dockerfile             # Node.js 서비스 Dockerfile
│   └── package.json           # Node.js 의존성 정의
├── oracle-init/               # DB 인스턴스 초기화 SQL 스크립트
│   ├── 00_init_memory.sql     # Oracle SGA/PGA 메모리 최적화 설정
│   └── 01_init.sql            # 테이블, 제약조건, 인덱스 생성 DDL
├── API_SPECIFICATION.md       # 상세 REST API 명세서
├── docker-compose.yaml        # 멀티 컨테이너(API + Oracle DB) 실행 설정
├── .env.example               # 샘플 환경 변수 템플릿 (비밀정보 분리)
├── .gitignore                 # 깃 추적 제외 설정
└── README.md                  # 운영 및 데이터베이스 스키마 설명 문서
```

---

## 📊 3. 데이터베이스 스키마 및 ERD (Detailed DB Schema)

### 📐 Entity Relationship Diagram (ERD)

```mermaid
erDiagram
    COMPANIES ||--o{ USERS : "has employees"
    COMPANIES ||--o{ TRIPS : "owns trips"
    COMPANIES ||--o{ CHECK_INS : "tracks checkins"
    COMPANIES ||--o{ EXPENSES : "records expenses"
    USERS ||--o{ TRIPS : "creates"
    USERS ||--o{ CHECK_INS : "performs"
    USERS ||--o{ EXPENSES : "submits"
    TRIPS ||--o{ CHECK_INS : "contains"
    TRIPS ||--o{ EXPENSES : "includes"

    COMPANIES {
        VARCHAR2(50) COMPANY_CODE PK "회사/테넌트 식별 코드"
        VARCHAR2(100) COMPANY_NAME "회사명"
        VARCHAR2(50) BUSINESS_NO "사업자등록번호"
        VARCHAR2(20) PLAN "구독 플랜 (starter|standard|enterprise)"
        VARCHAR2(20) STATUS "계정 상태 (active|suspended|inactive)"
        TIMESTAMP CREATED_AT "생성일시"
    }

    USERS {
        VARCHAR2(128) UID_VAL PK "사용자 고유 UID"
        VARCHAR2(255) EMAIL UK "이메일 주소"
        VARCHAR2(100) NAME "성명"
        VARCHAR2(20) ROLE "권한 (employee|manager|admin)"
        VARCHAR2(50) COMPANY_CODE FK "소속 회사 코드"
        VARCHAR2(50) TEAM_CODE "부서/팀 코드"
        TIMESTAMP CREATED_AT "생성일시"
    }

    TRIPS {
        VARCHAR2(128) ID PK "출장 건 고유 ID"
        VARCHAR2(128) USER_ID FK "신청자 ID"
        VARCHAR2(255) TITLE "출장 제목"
        VARCHAR2(20) STATUS "상태 (upcoming|ongoing|completed|cancelled)"
        VARCHAR2(10) START_DATE "시작일 (YYYY-MM-DD)"
        VARCHAR2(10) END_DATE "종료일 (YYYY-MM-DD)"
        VARCHAR2(255) DESTINATION "출장지"
        CLOB ITINERARY_JSON "일정 상세 JSON"
        VARCHAR2(500) PURPOSE "출장 목적"
        CLOB REPORT "출장 보고서"
        VARCHAR2(50) COMPANY_CODE FK "테넌트 코드"
        VARCHAR2(50) TEAM_CODE "팀 코드"
        NUMBER(1) IS_SHARED_WITH_TEAM "팀 공유 여부 (0|1)"
        TIMESTAMP CREATED_AT "생성일시"
    }

    CHECK_INS {
        VARCHAR2(128) ID PK "체크인 기록 ID"
        VARCHAR2(128) USER_ID FK "사용자 ID"
        VARCHAR2(128) TRIP_ID FK "출장 ID"
        NUMBER(15) TS_MILLIS "타임스탬프 (epoch ms)"
        VARCHAR2(255) LOCATION_NAME "체크인 장소 명칭"
        NUMBER(10,7) LAT "위도 (Latitude)"
        NUMBER(10,7) LNG "경도 (Longitude)"
        VARCHAR2(20) TYPE_VAL "구분 (check-in|check-out)"
        NUMBER(1) VERIFIED "위치 검증 여부 (0|1)"
        VARCHAR2(128) ITINERARY_ITEM_ID "일정 항목 ID"
        VARCHAR2(50) COMPANY_CODE FK "테넌트 코드"
        VARCHAR2(128) NFC_TAG_ID "NFC 태그 ID"
        TIMESTAMP CREATED_AT "생성일시"
    }

    EXPENSES {
        VARCHAR2(128) ID PK "경비 기록 ID"
        VARCHAR2(128) USER_ID FK "사용자 ID"
        VARCHAR2(128) TRIP_ID FK "출장 ID"
        VARCHAR2(10) EXPENSE_DATE "결제일자 (YYYY-MM-DD)"
        VARCHAR2(255) MERCHANT "가맹점/사용처"
        NUMBER(12,2) AMOUNT "금액"
        VARCHAR2(50) CATEGORY "경비 카테고리"
        VARCHAR2(1000) IMAGE_URL "영수증 이미지 URL"
        VARCHAR2(50) COMPANY_CODE FK "테넌트 코드"
        TIMESTAMP CREATED_AT "생성일시"
    }
```

---

### 📋 테이블별 상세 필드 정의

#### 1. `COMPANIES` (테넌트/회사 관리)
| 컬럼명 | 데이터 타입 | 제약 조건 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| **`COMPANY_CODE`** | `VARCHAR2(50)` | **PRIMARY KEY** | - | 테넌트 고유 코드 (예: `COMP01`, `COMP02`) |
| **`COMPANY_NAME`** | `VARCHAR2(100)` | NOT NULL | - | 회사명 |
| **`BUSINESS_NO`** | `VARCHAR2(50)` | Nullable | - | 사업자등록번호 |
| **`PLAN`** | `VARCHAR2(20)` | CHECK (`starter`, `standard`, `enterprise`) | `'standard'` | 구독 서비스 플랜 |
| **`STATUS`** | `VARCHAR2(20)` | CHECK (`active`, `suspended`, `inactive`) | `'active'` | 테넌트 계정 상태 |
| **`CREATED_AT`** | `TIMESTAMP` | NOT NULL | `CURRENT_TIMESTAMP` | 생성 일시 |

---

#### 2. `USERS` (사용자 계정)
| 컬럼명 | 데이터 타입 | 제약 조건 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| **`UID_VAL`** | `VARCHAR2(128)` | **PRIMARY KEY** | - | 사용자 고유 식별자 (Firebase Auth UID) |
| **`EMAIL`** | `VARCHAR2(255)` | **UNIQUE**, NOT NULL | - | 사용자 이메일 계정 |
| **`NAME`** | `VARCHAR2(100)` | NOT NULL | - | 사용자 이름 |
| **`ROLE`** | `VARCHAR2(20)` | CHECK (`employee`, `manager`, `admin`) | `'employee'` | 조직 내 역할 및 권한 |
| **`COMPANY_CODE`** | `VARCHAR2(50)` | **FK** (`COMPANIES.COMPANY_CODE`) ON DELETE CASCADE | - | 소속 회사 코드 (Multi-Tenancy Key) |
| **`TEAM_CODE`** | `VARCHAR2(50)` | Nullable | - | 소속 부서/팀 코드 |
| **`CREATED_AT`** | `TIMESTAMP` | NOT NULL | `CURRENT_TIMESTAMP` | 계정 생성 일시 |

---

#### 3. `TRIPS` (출장 일정 및 보고서)
| 컬럼명 | 데이터 타입 | 제약 조건 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| **`ID`** | `VARCHAR2(128)` | **PRIMARY KEY** | - | 출장 건 고유 ID |
| **`USER_ID`** | `VARCHAR2(128)` | **FK** (`USERS.UID_VAL`) ON DELETE CASCADE | - | 출장 등록 사용자 ID |
| **`TITLE`** | `VARCHAR2(255)` | NOT NULL | - | 출장 제목 |
| **`STATUS`** | `VARCHAR2(20)` | CHECK (`upcoming`, `ongoing`, `completed`, `cancelled`) | `'upcoming'` | 출장 상태 |
| **`START_DATE`** | `VARCHAR2(10)` | NOT NULL | - | 출장 시작일 (`YYYY-MM-DD`) |
| **`END_DATE`** | `VARCHAR2(10)` | NOT NULL | - | 출장 종료일 (`YYYY-MM-DD`) |
| **`DESTINATION`** | `VARCHAR2(255)` | NOT NULL | - | 출장지 (도시/지역명) |
| **`ITINERARY_JSON`**| `CLOB` | Nullable | - | 출장 일정 상세 정보 (JSON String) |
| **`PURPOSE`** | `VARCHAR2(500)` | Nullable | - | 출장 목적 및 개요 |
| **`REPORT`** | `CLOB` | Nullable | - | 출장 완료 보고서 내용 |
| **`COMPANY_CODE`** | `VARCHAR2(50)` | **FK** (`COMPANIES.COMPANY_CODE`) ON DELETE CASCADE | - | 테넌트 회사 코드 |
| **`TEAM_CODE`** | `VARCHAR2(50)` | Nullable | - | 담당 팀 코드 |
| **`IS_SHARED_WITH_TEAM`** | `NUMBER(1)` | CHECK (`0`, `1`) | `0` | 팀 구성원 일정 공유 여부 |
| **`CREATED_AT`** | `TIMESTAMP` | NOT NULL | `CURRENT_TIMESTAMP` | 작성 일시 |

---

#### 4. `CHECK_INS` (GPS/NFC 체크인 기록)
| 컬럼명 | 데이터 타입 | 제약 조건 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| **`ID`** | `VARCHAR2(128)` | **PRIMARY KEY** | - | 체크인 기록 고유 ID |
| **`USER_ID`** | `VARCHAR2(128)` | **FK** (`USERS.UID_VAL`) ON DELETE CASCADE | - | 체크인 사용자 ID |
| **`TRIP_ID`** | `VARCHAR2(128)` | **FK** (`TRIPS.ID`) ON DELETE CASCADE | - | 연결된 출장 ID |
| **`TS_MILLIS`** | `NUMBER(15)` | NOT NULL | - | 체크인 타임스탬프 (Epoch Milliseconds) |
| **`LOCATION_NAME`**| `VARCHAR2(255)` | NOT NULL | - | 체크인 장소 명칭 |
| **`LAT`** | `NUMBER(10,7)` | Nullable | - | 위도 (Latitude) |
| **`LNG`** | `NUMBER(10,7)` | Nullable | - | 경도 (Longitude) |
| **`TYPE_VAL`** | `VARCHAR2(20)` | CHECK (`check-in`, `check-out`) | - | 체크인 / 체크아웃 구분 |
| **`VERIFIED`** | `NUMBER(1)` | CHECK (`0`, `1`) | `1` | 위치/NFC 검증 완료 여부 |
| **`ITINERARY_ITEM_ID`**| `VARCHAR2(128)`| Nullable | - | 관련 일정 아이템 식별자 |
| **`COMPANY_CODE`** | `VARCHAR2(50)` | **FK** (`COMPANIES.COMPANY_CODE`) ON DELETE CASCADE | - | 테넌트 회사 코드 |
| **`NFC_TAG_ID`** | `VARCHAR2(128)` | Nullable | - | 태깅된 NFC 태그 ID |
| **`CREATED_AT`** | `TIMESTAMP` | NOT NULL | `CURRENT_TIMESTAMP` | 기록 일시 |

---

#### 5. `EXPENSES` (경비 정산 내역)
| 컬럼명 | 데이터 타입 | 제약 조건 | 기본값 | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| **`ID`** | `VARCHAR2(128)` | **PRIMARY KEY** | - | 경비 내역 고유 ID |
| **`USER_ID`** | `VARCHAR2(128)` | **FK** (`USERS.UID_VAL`) ON DELETE CASCADE | - | 지출 사용자 ID |
| **`TRIP_ID`** | `VARCHAR2(128)` | **FK** (`TRIPS.ID`) ON DELETE CASCADE | - | 연결된 출장 ID |
| **`EXPENSE_DATE`** | `VARCHAR2(10)` | NOT NULL | - | 지출 일자 (`YYYY-MM-DD`) |
| **`MERCHANT`** | `VARCHAR2(255)` | NOT NULL | - | 가맹점 / 사용처 명칭 |
| **`AMOUNT`** | `NUMBER(12,2)` | NOT NULL | - | 지출 금액 |
| **`CATEGORY`** | `VARCHAR2(50)` | NOT NULL | - | 경비 항목 (식비, 교통비, 숙박비, 기타 등) |
| **`IMAGE_URL`** | `VARCHAR2(1000)`| Nullable | - | 영수증 사진 URL |
| **`COMPANY_CODE`** | `VARCHAR2(50)` | **FK** (`COMPANIES.COMPANY_CODE`) ON DELETE CASCADE | - | 테넌트 회사 코드 |
| **`CREATED_AT`** | `TIMESTAMP` | NOT NULL | `CURRENT_TIMESTAMP` | 등록 일시 |

---

### ⚡ 인덱스 전략 (Indexes & Performance Optimization)

모든 쿼리 요청 시 테넌트 데이터 격리 및 조회 성능 향상을 위해 복합 인덱스(Compound Index)가 적용되어 있습니다.

1. **기본 외래키 단일 인덱스**:
   - `IDX_TRIPS_USER`: `TRIPS(USER_ID)`
   - `IDX_CHECKINS_TRIP`: `CHECK_INS(TRIP_ID)`
   - `IDX_EXPENSES_TRIP`: `EXPENSES(TRIP_ID)`
   - `IDX_CHECKINS_USER`: `CHECK_INS(USER_ID)`
   - `IDX_EXPENSES_USER`: `EXPENSES(USER_ID)`

2. **멀티테넌시 데이터 격리 복합 인덱스 (Multi-Tenancy Optimized Indexes)**:
   - `IDX_USERS_COMP_ROLE`: `USERS(COMPANY_CODE, ROLE)` - 테넌트 내 권한별 회원 조회 최적화
   - `IDX_TRIPS_COMP_USER`: `TRIPS(COMPANY_CODE, USER_ID)` - 테넌트 내 사용자 출장 목록 조회 최적화
   - `IDX_TRIPS_COMP_STATUS`: `TRIPS(COMPANY_CODE, STATUS)` - 테넌트 내 출장 상태별 집계 최적화
   - `IDX_CHECKINS_COMP_TRIP`: `CHECK_INS(COMPANY_CODE, TRIP_ID)` - 테넌트/출장별 체크인 조회 최적화
   - `IDX_EXPENSES_COMP_TRIP`: `EXPENSES(COMPANY_CODE, TRIP_ID)` - 테넌트/출장별 경비 집계 최적화

---

## 🔌 4. API 연동 및 호출 가이드 (API Request & Integration Guide)

### 🌐 4.1. 공통 요청 및 응답 규격 (Common Specification)

- **Base URL**: `http://localhost:3000/api` (Docker 외부 연결: `http://<SERVER_IP>:80/api`)
- **Headers**:
  - `Content-Type: application/json`
  - `Accept: application/json`
- **Multi-Tenancy 테넌트 데이터 조회**:
  - 데이터 요청 시 Query Parameter에 `companyCode` (예: `?companyCode=COMP01`)를 함께 전송하여 해당 테넌트 데이터만 안전하게 필터링하여 조회합니다.

#### ✅ 성공 응답 포맷 (HTTP 200 / 201)
```json
{
  "success": true,
  "message": "성공 안내 메시지 (선택)",
  "data": { ... } // 단일 객체 또는 배열
}
```

#### ❌ 에러 응답 포맷 (HTTP 400 / 404 / 409 / 500)
```json
{
  "success": false,
  "message": "에러 메시지 요약",
  "error": "상세 오라클 DB 에러 또는 시스템 메시지"
}
```

---

### 💻 4.2. 클라이언트 코드 예시 (Client Usage Examples)

#### 1) Modern JavaScript (`fetch` API / Async-Await)
```javascript
const BASE_URL = 'http://localhost:3000/api';

// 1. 특정 테넌트의 출장 목록 조회 (GET)
async function fetchTrips(companyCode = 'COMP01') {
  try {
    const response = await fetch(`${BASE_URL}/trips?companyCode=${companyCode}`);
    const result = await response.json();
    if (result.success) {
      console.log('출장 목록:', result.data);
    }
  } catch (error) {
    console.error('API 호출 에러:', error);
  }
}

// 2. 신규 GPS/NFC 체크인 등록 (POST)
async function createCheckIn(checkInData) {
  try {
    const response = await fetch(`${BASE_URL}/check-ins`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(checkInData)
    });
    const result = await response.json();
    return result;
  } catch (error) {
    console.error('체크인 등록 실패:', error);
  }
}
```

#### 2) Axios / Node.js
```javascript
const axios = require('axios');
const api = axios.create({ baseURL: 'http://localhost:3000/api' });

// 경비 내역 등록 API 호출
async function addExpense(expensePayload) {
  try {
    const res = await api.post('/expenses', {
      tripId: 'trip_101',
      userId: 'user_01',
      companyCode: 'COMP01',
      expenseDate: '2026-10-02',
      merchant: '이치란 라멘 도쿄점',
      amount: 1200,
      category: '식비'
    });
    console.log('경비 등록 완료:', res.data);
  } catch (err) {
    console.error('경비 등록 오류:', err.response?.data || err.message);
  }
}
```

#### 3) cURL (터미널 커맨드 테스트)
```bash
# 1. 헬스 체크 확인
curl -X GET http://localhost:3000/api/health

# 2. 특정 테넌트 회사 상세 및 통계 조회
curl -X GET http://localhost:3000/api/companies/COMP01

# 3. 신규 출장 등록
curl -X POST http://localhost:3000/api/trips \
  -H "Content-Type: application/json" \
  -d '{
    "title": "도쿄 IT 서밋 참석 출장",
    "startDate": "2026-11-01",
    "endDate": "2026-11-05",
    "destination": "Tokyo, Japan",
    "companyCode": "COMP01",
    "userId": "user_01",
    "purpose": "글로벌 파트너십 구축"
  }'

# 4. 엔화(JPY) 환율 변환 계산 (15,000 JPY -> KRW)
curl -X GET "http://localhost:3000/api/exchange-rate?jpy=15000"
```

---

### 📑 4.3. 도메인별 API 엔드포인트 요약

| 도메인 | HTTP Method | Endpoint | 필수 / 주요 파라미터 | 설명 |
| :--- | :--- | :--- | :--- | :--- |
| **시스템** | `GET` | `/api/health` | - | 백엔드 서버 작동 상태 확인 |
| **환율** | `GET` | `/api/exchange-rate` | Query: `jpy` (number) | JPY ➔ KRW 원화 환율 환산 |
| **테넌트/회사** | `GET` | `/api/companies` | - | 전체 회사/테넌트 목록 조회 |
| **테넌트/회사** | `GET` | `/api/companies/:code` | Path: `:code` | 특정 회사 상세 정보 및 소속 집계 통계 조회 |
| **테넌트/회사** | `POST` | `/api/companies` | Body: `companyCode`, `companyName`, `plan` | 신규 테넌트/회사 등록 |
| **사용자** | `GET` | `/api/users` | Query: `companyCode`, `role` | 테넌트별 사용자 목록 조회 |
| **사용자** | `GET` | `/api/users/:uid` | Path: `:uid` | 특정 사용자 프로필 상세 조회 |
| **사용자** | `POST` | `/api/users` | Body: `uid`, `email`, `name`, `companyCode` | 사용자 등록 및 정보 수정 (Upsert) |
| **출장 관리** | `GET` | `/api/trips` | Query: `companyCode`, `userId`, `status` | 테넌트별/사용자별 출장 목록 조회 |
| **출장 관리** | `GET` | `/api/trips/:id` | Path: `:id` | 출장 상세 정보 조회 |
| **출장 관리** | `POST` | `/api/trips` | Body: `title`, `startDate`, `endDate`, `companyCode` | 신규 출장 등록 |
| **출장 리포트** | `GET` | `/api/trips/:id/summary` | Path: `:id` | 해당 출장의 경비+체크인 종합 리포트 조회 |
| **체크인** | `GET` | `/api/check-ins` | Query: `companyCode`, `tripId`, `userId` | GPS/NFC 체크인 기록 조회 |
| **체크인** | `POST` | `/api/check-ins` | Body: `tripId`, `userId`, `locationName`, `type` | 위치(GPS) 및 NFC 체크인 기록 생성 |
| **경비 정산** | `GET` | `/api/expenses` | Query: `companyCode`, `tripId` | 출장 경비 영수증 내역 목록 조회 |
| **경비 정산** | `POST` | `/api/expenses` | Body: `tripId`, `expenseDate`, `merchant`, `amount` | 경비 지출 내역 등록 |
| **경비 정산** | `DELETE`| `/api/expenses/:id` | Path: `:id` | 특정 경비 내역 삭제 |

---

## 🔒 5. 보안 및 비밀정보 관리 (Security & Secrets)

- 본 저장소에는 DB 접속 비밀번호, JWT Secret, API Key 등 보안 민감 정보가 직접 포함되어 있지 않습니다.
- 모든 운영 설정은 **`.env`** 파일을 통해 주입됩니다.
- 로컬 또는 대시보드 환경 구축 시 **`.env.example`** 샘플 파일을 복사하여 `.env` 파일을 작성하십시오.

```bash
cp .env.example .env
```

---

## 🚀 6. 실행 및 서비스 운영 (Operations Guide)

### Docker Compose를 통한 서버 실행

```bash
# 1. 원격 저장소 클론 및 이동
git clone https://github.com/hangjin01/01BO_Server.git
cd 01BO_Server

# 2. 컨테이너 백그라운드 실행 (Oracle DB + Node API)
docker compose up -d

# 3. 컨테이너 실행 상태 확인
docker compose ps
```

### 멀티테넌시 DB 마이그레이션 및 시드 데이터 삽입

```bash
# 1. 멀티테넌시 스키마 마이그레이션 실행
node backend/migrate_multitenancy.js

# 2. 초기 테스트/시드 데이터 삽입
node backend/seed_data.js
```

---

## 📄 7. 라이선스 (License)

This project is licensed under the MIT License.