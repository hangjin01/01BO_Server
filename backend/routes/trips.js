const express = require('express');
const router = express.Router();
const { executeQuery } = require('../db');

// 1. 전체 출장 목록 조회
router.get('/', async (req, res) => {
    const { userId, status, companyCode } = req.query;
    let sql = `SELECT ID, USER_ID, TITLE, STATUS, START_DATE, END_DATE, DESTINATION, ITINERARY_JSON, PURPOSE, REPORT, COMPANY_CODE, TEAM_CODE, IS_SHARED_WITH_TEAM, CREATED_AT FROM TRIPS WHERE 1=1`;
    const binds = [];

    if (userId) {
        binds.push(userId);
        sql += ` AND USER_ID = :${binds.length}`;
    }
    if (status) {
        binds.push(status);
        sql += ` AND STATUS = :${binds.length}`;
    }
    if (companyCode) {
        binds.push(companyCode);
        sql += ` AND COMPANY_CODE = :${binds.length}`;
    }

    sql += ` ORDER BY START_DATE DESC, CREATED_AT DESC`;

    try {
        const result = await executeQuery(sql, binds);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. 특정 출장 상세 조회
router.get('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await executeQuery(
            `SELECT ID, USER_ID, TITLE, STATUS, START_DATE, END_DATE, DESTINATION, ITINERARY_JSON, PURPOSE, REPORT, COMPANY_CODE, TEAM_CODE, IS_SHARED_WITH_TEAM, CREATED_AT FROM TRIPS WHERE ID = :1`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Trip not found' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. 신규 출장 등록
router.post('/', async (req, res) => {
    const {
        id = `TRIP_${Date.now()}`,
        userId,
        title,
        status = 'upcoming',
        startDate,
        endDate,
        destination,
        itineraryJson = null,
        purpose = null,
        report = null,
        companyCode = 'COMP01',
        teamCode = 'TEAM01',
        isSharedWithTeam = 0
    } = req.body;

    if (!userId || !title || !startDate || !endDate || !destination) {
        return res.status(400).json({ success: false, message: 'userId, title, startDate, endDate, destination are required' });
    }

    try {
        const sql = `
            INSERT INTO TRIPS (ID, USER_ID, TITLE, STATUS, START_DATE, END_DATE, DESTINATION, ITINERARY_JSON, PURPOSE, REPORT, COMPANY_CODE, TEAM_CODE, IS_SHARED_WITH_TEAM)
            VALUES (:1, :2, :3, :4, :5, :6, :7, :8, :9, :10, :11, :12, :13)
        `;
        await executeQuery(sql, [
            id,
            userId,
            title,
            status,
            startDate,
            endDate,
            destination,
            typeof itineraryJson === 'object' ? JSON.stringify(itineraryJson) : itineraryJson,
            purpose,
            typeof report === 'object' ? JSON.stringify(report) : report,
            companyCode,
            teamCode,
            isSharedWithTeam ? 1 : 0
        ]);

        res.json({ success: true, message: 'Trip created successfully', data: { id, userId, title, status, destination } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. 출장 요약 리포트 (경비 & 체크인 종합)
router.get('/:id/summary', async (req, res) => {
    const { id } = req.params;
    const rate = parseFloat(req.query.rate || 9.15);

    try {
        const tripRes = await executeQuery(`SELECT ID, TITLE, USER_ID, START_DATE, END_DATE, DESTINATION FROM TRIPS WHERE ID = :1`, [id]);
        if (tripRes.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Trip not found' });
        }

        const expRes = await executeQuery(`SELECT AMOUNT, CATEGORY FROM EXPENSES WHERE TRIP_ID = :1`, [id]);
        const checkRes = await executeQuery(`SELECT COUNT(*) AS CNT FROM CHECK_INS WHERE TRIP_ID = :1`, [id]);

        let totalJpy = 0;
        const categorySummary = {};

        expRes.rows.forEach(exp => {
            const amt = parseFloat(exp.AMOUNT || 0);
            totalJpy += amt;
            const cat = exp.CATEGORY || 'ETC';
            categorySummary[cat] = (categorySummary[cat] || 0) + amt;
        });

        const totalKrw = Math.round(totalJpy * rate);

        res.json({
            success: true,
            trip: tripRes.rows[0],
            summary: {
                totalExpenseJpy: totalJpy,
                exchangeRate: rate,
                totalExpenseKrw: totalKrw,
                checkInCount: checkRes.rows[0] ? checkRes.rows[0].CNT : 0,
                byCategory: categorySummary
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;

