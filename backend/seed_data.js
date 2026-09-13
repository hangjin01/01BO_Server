const http = require('http');

const API_BASE = 'http://localhost:3000/api';

function postJson(path, data) {
    return new Promise((resolve, reject) => {
        const url = new URL(API_BASE + path);
        const bodyText = JSON.stringify(data);

        const options = {
            hostname: url.hostname,
            port: url.port,
            path: url.pathname,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyText)
            }
        };

        const req = http.request(options, (res) => {
            let resData = '';
            res.on('data', chunk => resData += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(resData));
                } catch (err) {
                    resolve({ raw: resData, status: res.statusCode });
                }
            });
        });

        req.on('error', reject);
        req.write(bodyText);
        req.end();
    });
}

async function seed() {
    console.log('🚀 [SEED] Starting Multi-Tenancy Mock Data Insertion...\n');

    // 0. COMPANIES (회사/테넌트 등록)
    const companies = [
        {
            companyCode: 'COMP01',
            companyName: '테크코리아 주식회사 (TechKorea Corp)',
            businessNo: '101-81-12345',
            plan: 'enterprise'
        },
        {
            companyCode: 'COMP02',
            companyName: '한일글로벌무역 (Hanil Global Trading)',
            businessNo: '202-86-67890',
            plan: 'standard'
        }
    ];

    console.log('--- 🏢 Inserting Companies ---');
    for (const c of companies) {
        const res = await postJson('/companies', c);
        console.log(`Company [${c.companyCode} - ${c.companyName}]:`, res.message || res);
    }

    // 1. USERS (사용자 데이터 - COMP01 & COMP02)
    const users = [
        // COMP01 소속 사용자
        {
            uid: 'user_kr_001',
            email: 'minjun.kim@company.com',
            name: '김민준 대리',
            role: 'employee',
            companyCode: 'COMP01',
            teamCode: 'TEAM_GLOBAL'
        },
        {
            uid: 'user_kr_002',
            email: 'seoyeon.lee@company.com',
            name: '이서연 팀장',
            role: 'manager',
            companyCode: 'COMP01',
            teamCode: 'TEAM_DEV'
        },
        {
            uid: 'user_jp_001',
            email: 'sato.kenji@company.co.jp',
            name: 'Sato Kenji (佐藤健二)',
            role: 'admin',
            companyCode: 'COMP01',
            teamCode: 'TEAM_JAPAN'
        },
        // COMP02 소속 사용자
        {
            uid: 'user_c2_001',
            email: 'jihoon.park@hanil-trading.com',
            name: '박지훈 부장',
            role: 'manager',
            companyCode: 'COMP02',
            teamCode: 'TRADE_DEPT'
        },
        {
            uid: 'user_c2_002',
            email: 'tanaka.yui@hanil-trading.co.jp',
            name: 'Tanaka Yui (田中結衣)',
            role: 'employee',
            companyCode: 'COMP02',
            teamCode: 'TRADE_DEPT'
        }
    ];

    console.log('\n--- 👤 Inserting Users ---');
    for (const u of users) {
        const res = await postJson('/users', u);
        console.log(`User [${u.name} (${u.companyCode})]:`, res.message || res);
    }

    // 2. TRIPS (출장 일정 데이터 - COMP01 & COMP02)
    const trips = [
        // COMP01 출장
        {
            id: 'TRIP_2026_TOKYO_01',
            userId: 'user_kr_001',
            title: '2026 도쿄 IT 전시회 참가 및 파트너사 기술 협력 미팅',
            status: 'ongoing',
            startDate: '2026-09-07',
            endDate: '2026-09-12',
            destination: '도쿄 (시부야 & 빅사이트)',
            purpose: '글로벌 IT 엑스포 참관 및 도쿄 지사 기술 교류',
            itineraryJson: [
                { day: 1, date: '2026-09-07', activity: '인천 공항 출발 -> 하네다 공항 입국 & 호텔 체크인' },
                { day: 2, date: '2026-09-08', activity: '도쿄 빅사이트 IT 엑스포 참관 및 파트너 미팅' },
                { day: 3, date: '2026-09-09', activity: '도쿄 지사(시부야) 세미나 발표' },
                { day: 4, date: '2026-09-10', activity: '신주쿠 파트너사 현장 방문 및 저녁 만찬' },
                { day: 5, date: '2026-09-11', activity: '귀국 준비 및 하네다 공항 이동' }
            ],
            companyCode: 'COMP01',
            teamCode: 'TEAM_GLOBAL',
            isSharedWithTeam: 1
        },
        {
            id: 'TRIP_2026_OSAKA_01',
            userId: 'user_kr_002',
            title: '오사카 서일본 물류센터 현장 실사 및 공급망 계약',
            status: 'upcoming',
            startDate: '2026-09-20',
            endDate: '2026-09-24',
            destination: '오사카 (우메다 & 난바)',
            purpose: '서일본 신규 물류거점 계약 및 파트너십 점검',
            itineraryJson: [
                { day: 1, date: '2026-09-20', activity: '간사이 국제공항 도착 후 난바 숙소 이동' },
                { day: 2, date: '2026-09-21', activity: '우메다 물류센터 현장 방문 실사' }
            ],
            companyCode: 'COMP01',
            teamCode: 'TEAM_DEV',
            isSharedWithTeam: 1
        },
        {
            id: 'TRIP_2026_FUKUOKA_01',
            userId: 'user_kr_001',
            title: '후쿠오카 클라우드 센터 정기 인프라 점검',
            status: 'completed',
            startDate: '2026-08-15',
            endDate: '2026-08-18',
            destination: '후쿠오카 (하카타 & 텐진)',
            purpose: '데이터센터 서버 증설 작업 및 네트워크 보안 점검',
            companyCode: 'COMP01',
            teamCode: 'TEAM_GLOBAL',
            isSharedWithTeam: 0
        },
        // COMP02 출장
        {
            id: 'TRIP_2026_NAGOYA_C2',
            userId: 'user_c2_001',
            title: '나고야 자동차 부품 수출입 정기 계약 협의',
            status: 'upcoming',
            startDate: '2026-10-05',
            endDate: '2026-10-09',
            destination: '나고야 (메이에키 & 사카에)',
            purpose: '주요 완성차 협력업체 공급 단가 및 선적 일정 협상',
            itineraryJson: [
                { day: 1, date: '2026-10-05', activity: '주부 국제공항 도착 및 나고야역 미팅룸 사전 준비' },
                { day: 2, date: '2026-10-06', activity: '토요타 계열 협력사 바이어 회의' }
            ],
            companyCode: 'COMP02',
            teamCode: 'TRADE_DEPT',
            isSharedWithTeam: 1
        }
    ];

    console.log('\n--- 🧳 Inserting Trips ---');
    for (const t of trips) {
        const res = await postJson('/trips', t);
        console.log(`Trip [${t.title} (${t.companyCode})]:`, res.message || res);
    }

    // 3. CHECK_INS (체크인 데이터)
    const checkIns = [
        {
            id: 'CHECK_TK_01',
            userId: 'user_kr_001',
            tripId: 'TRIP_2026_TOKYO_01',
            tsMillis: 1788739200000,
            locationName: '하네다 국제공항 제3터미널 (Haneda Airport T3)',
            lat: 35.5494,
            lng: 139.7798,
            typeVal: 'check-in',
            verified: 1,
            companyCode: 'COMP01',
            nfcTagId: 'NFC_HND_GATE3'
        },
        {
            id: 'CHECK_TK_02',
            userId: 'user_kr_001',
            tripId: 'TRIP_2026_TOKYO_01',
            tsMillis: 1788829200000,
            locationName: '도쿄 빅사이트 전시관 (Tokyo Big Sight Main Hall)',
            lat: 35.6298,
            lng: 139.7943,
            typeVal: 'check-in',
            verified: 1,
            companyCode: 'COMP01',
            nfcTagId: 'NFC_BIGSIGHT_MAIN'
        },
        {
            id: 'CHECK_C2_01',
            userId: 'user_c2_001',
            tripId: 'TRIP_2026_NAGOYA_C2',
            tsMillis: 1791244800000,
            locationName: '주부 국제공항 (Centrair Airport)',
            lat: 34.8584,
            lng: 136.8053,
            typeVal: 'check-in',
            verified: 1,
            companyCode: 'COMP02',
            nfcTagId: 'NFC_CENTRAIR_T1'
        }
    ];

    console.log('\n--- 📍 Inserting Check-ins ---');
    for (const c of checkIns) {
        const res = await postJson('/check-ins', c);
        console.log(`Check-in [${c.locationName} (${c.companyCode})]:`, res.message || res);
    }

    // 4. EXPENSES (경비 데이터)
    const expenses = [
        {
            id: 'EXP_TK_01',
            userId: 'user_kr_001',
            tripId: 'TRIP_2026_TOKYO_01',
            expenseDate: '2026-09-07',
            merchant: '스카이라이너 공항 고속철도 (하네다->시부야)',
            amount: 2470,
            category: 'TRANSPORT',
            companyCode: 'COMP01',
            imageUrl: 'https://storage.example.com/receipts/skyliner_01.jpg'
        },
        {
            id: 'EXP_TK_02',
            userId: 'user_kr_001',
            tripId: 'TRIP_2026_TOKYO_01',
            expenseDate: '2026-09-07',
            merchant: '이치란 라멘 시부야점 (첫날 점심 식사)',
            amount: 1480,
            category: 'MEAL',
            companyCode: 'COMP01'
        },
        {
            id: 'EXP_C2_01',
            userId: 'user_c2_001',
            tripId: 'TRIP_2026_NAGOYA_C2',
            expenseDate: '2026-10-05',
            merchant: '메이테츠 특급 뮤스카이 고속열차',
            amount: 1250,
            category: 'TRANSPORT',
            companyCode: 'COMP02'
        }
    ];

    console.log('\n--- 💳 Inserting Expenses ---');
    for (const e of expenses) {
        const res = await postJson('/expenses', e);
        console.log(`Expense [${e.merchant} (${e.amount} JPY - ${e.companyCode})]:`, res.message || res);
    }

    console.log('\n🎉 [SEED] Multi-tenancy Mock data insertion complete!');
}

seed().catch(err => {
    console.error('❌ [SEED] Error inserting seed data:', err);
});
