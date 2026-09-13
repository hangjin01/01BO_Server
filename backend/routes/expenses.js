const express = require('express');
const router = express.Router();
const { executeQuery } = require('../db');

// 1. 경비 목록 조회 (쿼리: tripId, userId, category, companyCode)
router.get('/', async (req, res) => {
    const { tripId, userId, category, companyCode } = req.query;
    let sql = `SELECT ID, USER_ID, TRIP_ID, EXPENSE_DATE, MERCHANT, AMOUNT, CATEGORY, IMAGE_URL, COMPANY_CODE, CREATED_AT FROM EXPENSES WHERE 1=1`;
    const binds = {};

    if (tripId) {
        sql += ` AND TRIP_ID = :tripId`;
        binds.tripId = tripId;
    }
    if (userId) {
        sql += ` AND USER_ID = :userId`;
        binds.userId = userId;
    }
    if (category) {
        sql += ` AND CATEGORY = :category`;
        binds.category = category;
    }
    if (companyCode) {
        sql += ` AND COMPANY_CODE = :companyCode`;
        binds.companyCode = companyCode;
    }

    sql += ` ORDER BY EXPENSE_DATE DESC, CREATED_AT DESC`;

    try {
        const result = await executeQuery(sql, binds);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. 신규 경비 등록
router.post('/', async (req, res) => {
    const {
        id = `EXP_${Date.now()}`,
        userId,
        tripId,
        expenseDate = new Date().toISOString().substring(0, 10),
        merchant,
        amount,
        category = 'MEAL',
        imageUrl = null,
        companyCode = 'COMP01'
    } = req.body;

    if (!userId || !tripId || !merchant || amount === undefined) {
        return res.status(400).json({ success: false, message: 'userId, tripId, merchant, amount are required' });
    }

    try {
        const sql = `
            INSERT INTO EXPENSES (ID, USER_ID, TRIP_ID, EXPENSE_DATE, MERCHANT, AMOUNT, CATEGORY, IMAGE_URL, COMPANY_CODE)
            VALUES (:id, :userId, :tripId, :expenseDate, :merchant, :amount, :category, :imageUrl, :companyCode)
        `;
        await executeQuery(sql, {
            id,
            userId,
            tripId,
            expenseDate,
            merchant,
            amount: parseFloat(amount),
            category,
            imageUrl,
            companyCode
        });

        res.json({ success: true, message: 'Expense recorded successfully', data: { id, userId, tripId, merchant, amount, category } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. 경비 내역 삭제
router.delete('/:id', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await executeQuery(`DELETE FROM EXPENSES WHERE ID = :id`, [id]);
        if (result.rowsAffected === 0) {
            return res.status(404).json({ success: false, message: 'Expense not found' });
        }
        res.json({ success: true, message: 'Expense deleted successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
