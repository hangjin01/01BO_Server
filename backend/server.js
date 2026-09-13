const express = require('express');
const cors = require('cors');
const { initializePool } = require('./db');

const usersRouter = require('./routes/users');
const tripsRouter = require('./routes/trips');
const checkInsRouter = require('./routes/checkins');
const expensesRouter = require('./routes/expenses');
const companiesRouter = require('./routes/companies');

const app = express();
const PORT = process.env.PORT || 3000;

// 미들웨어 설정
app.use(cors());
app.use(express.json());

// 라우터 등록
app.use('/api/companies', companiesRouter);
app.use('/api/users', usersRouter);
app.use('/api/trips', tripsRouter);
app.use('/api/check-ins', checkInsRouter);
app.use('/api/expenses', expensesRouter);

// 기본 상태 확인 엔드포인트
app.get('/api/health', (req, res) => {
    res.json({
        status: 'OK',
        message: 'Japan Trip Backend is running!',
        timestamp: new Date().toISOString()
    });
});

// 출장 경비 환율 계산 API (JPY -> KRW)
app.get('/api/exchange-rate', (req, res) => {
    const jpyAmount = parseFloat(req.query.jpy || 0);
    const mockRate = 9.15; // 1 JPY = 9.15 KRW (예시)
    const krwAmount = Math.round(jpyAmount * mockRate);

    res.json({
        jpy: jpyAmount,
        rate: mockRate,
        krw: krwAmount
    });
});

// 서버 시작 시 DB 풀 초기화
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`Server running on port ${PORT}`);
    await initializePool();
});
