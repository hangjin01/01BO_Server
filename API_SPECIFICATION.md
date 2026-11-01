# ✈️ 일본 출장/여행 관리 시스템 (Japan Trip App) - REST API 명세서

> 이 문서는 초기 명세입니다. 2026-11-01 운영 소스의 인증·회사 접근 제어·신규 API는 [운영 소스 반영 기록](docs/SERVER_SYNC_20261101.md)과 실행 코드를 확인하세요. 아래 예시를 현재 서비스의 인증 없는 호출 계약으로 사용하지 마세요.

본 문서에는 **일본 출장 및 여행 관리 시스템 백엔드 API**의 상세 명세, 요청/응답 규격, 데이터 구조 및 예시가 작성되어 있습니다.

---

## 📌 1. 시스템 개요 (Overview)

* **Base URL**: `http://localhost:3000/api` (Docker 배포 환경: `http://<HOST>:80/api`)
* **데이터 포맷**: `application/json` (UTF-8)
* **데이터베이스**: Oracle Database 18c/21c XE
* **아키텍처 모델**: **멀티 테넌시 (단일 DB + Row-level `COMPANY_CODE` 격리)**
  * 단일 데이터베이스 내에서 `COMPANY_CODE`를 키로 사용하여 회사(테넌트)별 데이터 완전 분리
  * 복합 인덱스(`COMPANY_CODE, ...`)를 통한 테넌트 쿼리 성능 극대화 및 외래키 무결성 보장
* **주요 기능**: 회사/테넌트 관리, 사용자 관리, 출장 일정 등록/조회, 위치/NFC 체크인 기록, 출장 경비 정산 및 환율 변환 종합 리포트

---

## 🌐 2. 공통 응답 포맷 (Common Response Format)

### ✅ 성공 응답 (Success)
```json
{
  "success": true,
  "message": "성공 메시지 (선택 사항)",
  "data": { ... } // 객체 또는 배열
}
```

### ❌ 실패 응답 (Error)
```json
{
  "success": false,
  "message": "에러 메시지 요약",
  "error": "상세 에러 내용 (선택 사항)"
}
```

---

## 🛠️ 3. API 엔드포인트 목록 (API Index)

| 도메인 | HTTP Method | Endpoint | 설명 |
| :--- | :--- | :--- | :--- |
| **시스템** | `GET` | `/api/health` | 백엔드 헬스 체크 상태 확인 |
| **환율** | `GET` | `/api/exchange-rate` | 엔화(JPY) ➔ 원화(KRW) 환율 계산 |
| **회사(테넌트)** | `GET` | `/api/companies` | 전체 회사/테넌트 목록 조회 |
| **회사(테넌트)** | `GET` | `/api/companies/:code` | 특정 회사 상세 정보 및 소속 통계 요약 조회 |
| **회사(테넌트)** | `POST` | `/api/companies` | 신규 회사/테넌트 등록 |
| **회사(테넌트)** | `PUT` | `/api/companies/:code` | 회사 정보 수정 |
| **사용자** | `GET` | `/api/users` | 사용자 목록 조회 (companyCode 필터링) |
| **사용자** | `GET` | `/api/users/:uid` | 특정 사용자 상세 조회 |
| **사용자** | `POST` | `/api/users` | 사용자 생성 및 수정 (Upsert) |
| **출장** | `GET` | `/api/trips` | 출장 목록 조회 (companyCode, status 등 필터링) |
| **출장** | `GET` | `/api/trips/:id` | 특정 출장 상세 조회 |
| **출장** | `POST` | `/api/trips` | 신규 출장 등록 |
| **출장** | `GET` | `/api/trips/:id/summary` | 출장 경비 & 체크인 종합 리포트 |
| **체크인** | `GET` | `/api/check-ins` | 체크인/체크아웃 기록 조회 (companyCode 필터링) |
| **체크인** | `POST` | `/api/check-ins` | 체크인/체크아웃 등록 (GPS/NFC) |
| **경비** | `GET` | `/api/expenses` | 출장 경비 목록 조회 (companyCode 필터링) |
| **경비** | `POST` | `/api/expenses` | 신규 경비 등록 |
| **경비** | `DELETE` | `/api/expenses/:id` | 경비 내역 삭제 |

---

## 📄 4. 상세 API 명세 (Detailed API Specifications)

---

### 🟢 4.1. 시스템 & 환율 API

#### 1) 백엔드 헬스 체크
* **HTTP Method**: `GET`
* **Path**: `/api/health`
* **설명**: 백엔드 서버 작동 여부 및 현재 시간 반환

**Response Example (200 OK):**
```json
{
  "status": "OK",
  "message": "Japan Trip Backend is running!",
  "timestamp": "2026-09-08T07:47:15.000Z"
}
```

---

#### 2) 엔화 환율 계산 API
* **HTTP Method**: `GET`
* **Path**: `/api/exchange-rate`
* **설명**: 지정한 엔화(JPY) 금액을 원화(KRW)로 환산 계산

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `jpy` | number | No | `0` | 환율 변환할 JPY 금액 |

**Response Example (200 OK):**
```json
{
  "jpy": 15000,
  "rate": 9.15,
  "krw": 137250
}
```

---

### 🏢 4.2. 회사 및 멀티 테넌트 관리 API (`/api/companies`)

#### 1) 전체 회사 목록 조회
* **HTTP Method**: `GET`
* **Path**: `/api/companies`
* **설명**: 등록된 모든 회사(테넌트) 목록 조회

**Response Example (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "COMPANY_CODE": "COMP01",
      "COMPANY_NAME": "테크코리아 주식회사 (TechKorea)",
      "BUSINESS_NO": "101-81-12345",
      "PLAN": "enterprise",
      "STATUS": "active",
      "CREATED_AT": "2026-09-08T08:35:30.587Z"
    },
    {
      "COMPANY_CODE": "COMP02",
      "COMPANY_NAME": "한일글로벌무역 (Hanil Trading)",
      "BUSINESS_NO": "202-86-67890",
      "PLAN": "standard",
      "STATUS": "active",
      "CREATED_AT": "2026-09-08T08:35:30.617Z"
    }
  ]
}
```

---

#### 2) 특정 회사 상세 정보 및 소속 통계 요약 조회
* **HTTP Method**: `GET`
* **Path**: `/api/companies/:code`
* **설명**: 회사 기본 정보 및 소속된 사용자 수, 출장 수, 총 경비 지출액 통계 반환

**Response Example (200 OK):**
```json
{
  "success": true,
  "data": {
    "COMPANY_CODE": "COMP01",
    "COMPANY_NAME": "테크코리아 주식회사 (TechKorea)",
    "BUSINESS_NO": "101-81-12345",
    "PLAN": "enterprise",
    "STATUS": "active",
    "CREATED_AT": "2026-09-08T08:35:30.587Z",
    "stats": {
      "userCount": 4,
      "tripCount": 4,
      "totalExpenseAmount": 91000
    }
  }
}
```

---

#### 3) 신규 회사(테넌트) 등록
* **HTTP Method**: `POST`
* **Path**: `/api/companies`
* **설명**: 신규 회사 및 테넌트 코드 등록

**Request Body:**
```json
{
  "companyCode": "COMP03",
  "companyName": "도쿄네트웍스 (Tokyo Networks)",
  "businessNo": "303-88-11223",
  "plan": "standard"
}
```

**Response Example (201 Created):**
```json
{
  "success": true,
  "message": "Company created successfully",
  "data": {
    "companyCode": "COMP03",
    "companyName": "도쿄네트웍스 (Tokyo Networks)",
    "businessNo": "303-88-11223",
    "plan": "standard",
    "status": "active"
  }
}
```

---

### 👤 4.3. 사용자 관리 API (`/api/users`)

#### 1) 전체 사용자 목록 조회 (회사별 필터링 지원)
* **HTTP Method**: `GET`
* **Path**: `/api/users`
* **Query Parameters**:
  * `companyCode` (string, optional): 특정 회사 소속 사용자만 필터링 (예: `COMP01`, `COMP02`)
  * `role` (string, optional): 역할 필터링 (`employee`, `manager`, `admin`)
* **설명**: 시스템에 등록된 사용자 목록 조회. 회사코드로 격리 조회 가능.

**Response Example (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "UID_VAL": "user_001",
      "EMAIL": "hong@company.com",
      "NAME": "홍길동",
      "ROLE": "employee",
      "COMPANY_CODE": "COMP01",
      "TEAM_CODE": "TEAM01",
      "CREATED_AT": "2026-09-01T09:00:00.000Z"
    }
  ]
}
```

---

#### 2) 특정 사용자 상세 조회
* **HTTP Method**: `GET`
* **Path**: `/api/users/:uid`
* **설명**: UID를 기반으로 특정 사용자 정보 조회

**Path Parameters:**
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `uid` | string | Yes | 사용자 식별자 ID |

**Response Example (200 OK):**
```json
{
  "success": true,
  "data": {
    "UID_VAL": "user_001",
    "EMAIL": "hong@company.com",
    "NAME": "홍길동",
    "ROLE": "employee",
    "COMPANY_CODE": "COMP01",
    "TEAM_CODE": "TEAM01",
    "CREATED_AT": "2026-09-01T09:00:00.000Z"
  }
}
```

**Error Response (404 Not Found):**
```json
{
  "success": false,
  "message": "User not found"
}
```

---

#### 3) 사용자 등록 및 수정 (Upsert)
* **HTTP Method**: `POST`
* **Path**: `/api/users`
* **설명**: 신규 사용자를 생성합니다. 이미 존재하는 `uid`인 경우 사용자 정보를 업데이트합니다.

**Request Body Parameters:**
| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `uid` | string | **Yes** | - | 사용자 UID 고유 값 |
| `email` | string | **Yes** | - | 사용자 이메일 주소 |
| `name` | string | **Yes** | - | 사용자 이름 |
| `role` | string | No | `'employee'` | 역할 (`'employee'`, `'manager'`, `'admin'`) |
| `companyCode` | string | No | `'COMP01'` | 회사 코드 |
| `teamCode` | string | No | `'TEAM01'` | 팀 코드 |

**Request Body Example:**
```json
{
  "uid": "user_002",
  "email": "kim@company.com",
  "name": "김철수",
  "role": "manager",
  "companyCode": "COMP01",
  "teamCode": "TEAM02"
}
```

**Response Example (200 OK - 생성 시):**
```json
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "uid": "user_002",
    "email": "kim@company.com",
    "name": "김철수",
    "role": "manager",
    "companyCode": "COMP01",
    "teamCode": "TEAM02"
  }
}
```

---

### 🧳 4.3. 출장 일정 API (`/api/trips`)

#### 1) 출장 목록 조회
* **HTTP Method**: `GET`
* **Path**: `/api/trips`
* **설명**: 등록된 출장 목록을 필터링 조건에 따라 조회

**Query Parameters:**
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `userId` | string | No | 특정 사용자 출장만 조회 |
| `status` | string | No | 출장 상태 (`'upcoming'`, `'ongoing'`, `'completed'`, `'cancelled'`) |
| `companyCode` | string | No | 회사 코드 기준 필터링 |

**Response Example (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "ID": "TRIP_1725780000000",
      "USER_ID": "user_001",
      "TITLE": "도쿄 IT 파트너사 미팅 및 전시회 참가",
      "STATUS": "ongoing",
      "START_DATE": "2026-09-10",
      "END_DATE": "2026-09-15",
      "DESTINATION": "Tokyo, Japan",
      "ITINERARY_JSON": "[{\"day\":1,\"activity\":\"도쿄 도착 및 숙소 체크인\"}]",
      "PURPOSE": "신규 프로젝트 파트너십 협의",
      "REPORT": null,
      "COMPANY_CODE": "COMP01",
      "TEAM_CODE": "TEAM01",
      "IS_SHARED_WITH_TEAM": 1,
      "CREATED_AT": "2026-09-08T07:00:00.000Z"
    }
  ]
}
```

---

#### 2) 특정 출장 상세 조회
* **HTTP Method**: `GET`
* **Path**: `/api/trips/:id`
* **설명**: 출장 ID 기반 특정 출장 상세 정보 조회

**Path Parameters:**
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | string | Yes | 출장 고유 ID (`TRIP_...`) |

**Response Example (200 OK):**
```json
{
  "success": true,
  "data": {
    "ID": "TRIP_1725780000000",
    "USER_ID": "user_001",
    "TITLE": "도쿄 IT 파트너사 미팅",
    "STATUS": "upcoming",
    "START_DATE": "2026-09-10",
    "END_DATE": "2026-09-15",
    "DESTINATION": "Tokyo, Japan",
    "ITINERARY_JSON": "[{\"day\":1,\"activity\":\"도쿄 도착\"}]",
    "PURPOSE": "신규 파트너십 미팅",
    "REPORT": null,
    "COMPANY_CODE": "COMP01",
    "TEAM_CODE": "TEAM01",
    "IS_SHARED_WITH_TEAM": 1,
    "CREATED_AT": "2026-09-08T07:00:00.000Z"
  }
}
```

---

#### 3) 신규 출장 등록
* **HTTP Method**: `POST`
* **Path**: `/api/trips`
* **설명**: 새로운 출장 일정을 등록합니다.

**Request Body Parameters:**
| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | string | No | `TRIP_${Date.now()}` | 출장 고유 ID |
| `userId` | string | **Yes** | - | 출장자 사용자 UID |
| `title` | string | **Yes** | - | 출장 제목 |
| `status` | string | No | `'upcoming'` | 출장 상태 |
| `startDate` | string | **Yes** | - | 출장 시작일 (`YYYY-MM-DD`) |
| `endDate` | string | **Yes** | - | 출장 종료일 (`YYYY-MM-DD`) |
| `destination` | string | **Yes** | - | 출장지 (도시/장소명) |
| `itineraryJson` | object \| string | No | `null` | 상세 일정 JSON 객체 또는 문자열 |
| `purpose` | string | No | `null` | 출장 목적 |
| `report` | object \| string | No | `null` | 출장 보고서 내용 |
| `companyCode` | string | No | `'COMP01'` | 회사 코드 |
| `teamCode` | string | No | `'TEAM01'` | 팀 코드 |
| `isSharedWithTeam` | boolean \| number | No | `0` | 팀 공유 여부 (`0` 또는 `1`) |

**Request Body Example:**
```json
{
  "userId": "user_001",
  "title": "오사카 바이어 미팅 출장",
  "startDate": "2026-10-01",
  "endDate": "2026-10-05",
  "destination": "Osaka, Japan",
  "purpose": "2026년 4분기 공급망 계약 체결",
  "isSharedWithTeam": 1
}
```

**Response Example (200 OK):**
```json
{
  "success": true,
  "message": "Trip created successfully",
  "data": {
    "id": "TRIP_1725781234567",
    "userId": "user_001",
    "title": "오사카 바이어 미팅 출장",
    "status": "upcoming",
    "destination": "Osaka, Japan"
  }
}
```

---

#### 4) 출장 종합 요약 리포트
* **HTTP Method**: `GET`
* **Path**: `/api/trips/:id/summary`
* **설명**: 특정 출장의 경비 지출 내역 합계(JPY & KRW 변환), 카테고리별 경비 요약 및 위치 체크인 총 횟수를 집계 리포트로 제공

**Path Parameters:**
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | string | Yes | 출장 고유 ID |

**Query Parameters:**
| Parameter | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `rate` | number | No | `9.15` | 적용할 JPY -> KRW 환율 |

**Response Example (200 OK):**
```json
{
  "success": true,
  "trip": {
    "ID": "TRIP_1725780000000",
    "TITLE": "도쿄 IT 파트너사 미팅",
    "USER_ID": "user_001",
    "START_DATE": "2026-09-10",
    "END_DATE": "2026-09-15",
    "DESTINATION": "Tokyo, Japan"
  },
  "summary": {
    "totalExpenseJpy": 48500,
    "exchangeRate": 9.15,
    "totalExpenseKrw": 443775,
    "checkInCount": 8,
    "byCategory": {
      "MEAL": 18500,
      "TRANSPORT": 20000,
      "ACCOMMODATION": 10000
    }
  }
}
```

---

### 📍 4.4. 위치 체크인 API (`/api/check-ins`)

#### 1) 체크인 기록 목록 조회
* **HTTP Method**: `GET`
* **Path**: `/api/check-ins`
* **설명**: 위치/NFC 체크인 기록 목록 조회 (타임스탬프 내림차순 정렬)

**Query Parameters:**
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `tripId` | string | No | 특정 출장의 체크인 기록만 조회 |
| `userId` | string | No | 특정 사용자의 체크인 기록만 조회 |

**Response Example (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "ID": "CHECK_1725782000000",
      "USER_ID": "user_001",
      "TRIP_ID": "TRIP_1725780000000",
      "TS_MILLIS": 1725782000000,
      "LOCATION_NAME": "도쿄 Big Sight 전시장",
      "LAT": 35.629815,
      "LNG": 139.794276,
      "TYPE_VAL": "check-in",
      "VERIFIED": 1,
      "ITINERARY_ITEM_ID": "ITEM_01",
      "COMPANY_CODE": "COMP01",
      "NFC_TAG_ID": "NFC_TAG_9982",
      "CREATED_AT": "2026-09-08T08:00:00.000Z"
    }
  ]
}
```

---

#### 2) 체크인 / 체크아웃 등록
* **HTTP Method**: `POST`
* **Path**: `/api/check-ins`
* **설명**: GPS 좌표 및 NFC 태그 정보를 포함한 위치 체크인/체크아웃 기록 생성

**Request Body Parameters:**
| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | string | No | `CHECK_${Date.now()}` | 체크인 고유 ID |
| `userId` | string | **Yes** | - | 사용자 UID |
| `tripId` | string | **Yes** | - | 출장 ID |
| `tsMillis` | number | No | `Date.now()` | 체크인 시간 (Epoch MS) |
| `locationName` | string | **Yes** | - | 위치/장소 명칭 |
| `lat` | number \| string | No | `null` | 위도 (Latitude) |
| `lng` | number \| string | No | `null` | 경도 (Longitude) |
| `typeVal` | string | No | `'check-in'` | 체크 구분 (`'check-in'`, `'check-out'`) |
| `verified` | boolean \| number | No | `1` | 검증 여부 (`0` 또는 `1`) |
| `itineraryItemId` | string | No | `null` | 연관 일정 항목 ID |
| `companyCode` | string | No | `'COMP01'` | 회사 코드 |
| `nfcTagId` | string | No | `null` | 인식된 NFC 태그 ID |

**Request Body Example:**
```json
{
  "userId": "user_001",
  "tripId": "TRIP_1725780000000",
  "locationName": "하네다 공항 제3터미널",
  "lat": 35.5494,
  "lng": 139.7798,
  "typeVal": "check-in",
  "nfcTagId": "NFC_HND_01"
}
```

**Response Example (200 OK):**
```json
{
  "success": true,
  "message": "Check-in recorded successfully",
  "data": {
    "id": "CHECK_1725783333333",
    "userId": "user_001",
    "tripId": "TRIP_1725780000000",
    "locationName": "하네다 공항 제3터미널",
    "typeVal": "check-in"
  }
}
```

---

### 💳 4.5. 경비 정산 API (`/api/expenses`)

#### 1) 경비 목록 조회
* **HTTP Method**: `GET`
* **Path**: `/api/expenses`
* **설명**: 출장 중 사용한 경비 내역 목록 조회 (최신 지출일 순)

**Query Parameters:**
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `tripId` | string | No | 특정 출장의 경비만 조회 |
| `userId` | string | No | 특정 사용자의 경비만 조회 |
| `category` | string | No | 경비 카테고리 (`MEAL`, `TRANSPORT`, `ACCOMMODATION`, `SUPPLIES`, `ETC`) |

**Response Example (200 OK):**
```json
{
  "success": true,
  "data": [
    {
      "ID": "EXP_1725784000000",
      "USER_ID": "user_001",
      "TRIP_ID": "TRIP_1725780000000",
      "EXPENSE_DATE": "2026-09-11",
      "MERCHANT": "Ichiran Ramen Shinjuku",
      "AMOUNT": 1250,
      "CATEGORY": "MEAL",
      "IMAGE_URL": "https://storage.example.com/receipts/rec_001.jpg",
      "COMPANY_CODE": "COMP01",
      "CREATED_AT": "2026-09-08T09:00:00.000Z"
    }
  ]
}
```

---

#### 2) 신규 경비 등록
* **HTTP Method**: `POST`
* **Path**: `/api/expenses`
* **설명**: 출장 중 발생한 영수증/경비 내역 등록

**Request Body Parameters:**
| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `id` | string | No | `EXP_${Date.now()}` | 경비 항목 고유 ID |
| `userId` | string | **Yes** | - | 사용자 UID |
| `tripId` | string | **Yes** | - | 출장 ID |
| `expenseDate` | string | No | 오늘 날짜 (`YYYY-MM-DD`) | 지출 일자 |
| `merchant` | string | **Yes** | - | 사용처 (가맹점명) |
| `amount` | number | **Yes** | - | 지출 금액 (JPY) |
| `category` | string | No | `'MEAL'` | 카테고리 (`MEAL`, `TRANSPORT`, `ACCOMMODATION`, `ETC` 등) |
| `imageUrl` | string | No | `null` | 영수증 이미지 URL |
| `companyCode` | string | No | `'COMP01'` | 회사 코드 |

**Request Body Example:**
```json
{
  "userId": "user_001",
  "tripId": "TRIP_1725780000000",
  "expenseDate": "2026-09-11",
  "merchant": "신칸센 도쿄->신오사카 티켓",
  "amount": 14500,
  "category": "TRANSPORT",
  "imageUrl": "https://storage.example.com/receipts/shinkansen.jpg"
}
```

**Response Example (200 OK):**
```json
{
  "success": true,
  "message": "Expense recorded successfully",
  "data": {
    "id": "EXP_1725785555555",
    "userId": "user_001",
    "tripId": "TRIP_1725780000000",
    "merchant": "신칸센 도쿄->신오사카 티켓",
    "amount": 14500,
    "category": "TRANSPORT"
  }
}
```

---

#### 3) 경비 내역 삭제
* **HTTP Method**: `DELETE`
* **Path**: `/api/expenses/:id`
* **설명**: 지정한 경비 항목 삭제

**Path Parameters:**
| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `id` | string | Yes | 경비 항목 고유 ID (`EXP_...`) |

**Response Example (200 OK):**
```json
{
  "success": true,
  "message": "Expense deleted successfully"
}
```

**Error Response (404 Not Found):**
```json
{
  "success": false,
  "message": "Expense not found"
}
```

---

## 🔒 5. HTTP 상태 코드 가이드 (HTTP Status Codes)

| 상태 코드 | 의미 | 설명 |
| :--- | :--- | :--- |
| `200 OK` | 성공 | 요청이 성공적으로 처리됨 |
| `400 Bad Request` | 잘못된 요청 | 필수 데이터 누락 또는 유효하지 않은 데이터 전달 시 |
| `404 Not Found` | 리소스 없음 | 요청한 리소스(사용자, 출장, 경비 등)를 찾을 수 없음 |
| `500 Internal Server Error` | 서버 에러 | 데이터베이스 쿼리 오류 또는 서버 내부 에러 발생 시 |

---

## 🗄️ 6. 데이터베이스 테이블 관계도 (Database Schema Reference)

```mermaid
erdiagram
    USERS ||--o{ TRIPS : "has many"
    USERS ||--o{ CHECK_INS : "records"
    USERS ||--o{ EXPENSES : "incurs"
    TRIPS ||--o{ CHECK_INS : "contains"
    TRIPS ||--o{ EXPENSES : "includes"

    USERS {
        VARCHAR2 UID_VAL PK
        VARCHAR2 EMAIL UK
        VARCHAR2 NAME
        VARCHAR2 ROLE
        VARCHAR2 COMPANY_CODE
        VARCHAR2 TEAM_CODE
    }

    TRIPS {
        VARCHAR2 ID PK
        VARCHAR2 USER_ID FK
        VARCHAR2 TITLE
        VARCHAR2 STATUS
        VARCHAR2 START_DATE
        VARCHAR2 END_DATE
        VARCHAR2 DESTINATION
        CLOB ITINERARY_JSON
        VARCHAR2 PURPOSE
    }

    CHECK_INS {
        VARCHAR2 ID PK
        VARCHAR2 USER_ID FK
        VARCHAR2 TRIP_ID FK
        NUMBER TS_MILLIS
        VARCHAR2 LOCATION_NAME
        NUMBER LAT
        NUMBER LNG
        VARCHAR2 TYPE_VAL
    }

    EXPENSES {
        VARCHAR2 ID PK
        VARCHAR2 USER_ID FK
        VARCHAR2 TRIP_ID FK
        VARCHAR2 EXPENSE_DATE
        VARCHAR2 MERCHANT
        NUMBER AMOUNT
        VARCHAR2 CATEGORY
        VARCHAR2 IMAGE_URL
    }
```
