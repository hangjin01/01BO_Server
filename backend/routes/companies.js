const express = require('express');
const router = express.Router();
const { executeQuery } = require('../db');

// 1. 전체 회사 목록 조회
router.get('/', async (req, res) => {
    try {
        const result = await executeQuery(
            `SELECT COMPANY_CODE, COMPANY_NAME, BUSINESS_NO, PLAN, STATUS, CREATED_AT 
             FROM COMPANIES 
             ORDER BY CREATED_AT DESC`
        );
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. 특정 회사 상세 정보 및 테넌트 요약 통계 조회
router.get('/:code', async (req, res) => {
    const { code } = req.params;
    try {
        const compResult = await executeQuery(
            `SELECT COMPANY_CODE, COMPANY_NAME, BUSINESS_NO, PLAN, STATUS, CREATED_AT 
             FROM COMPANIES 
             WHERE COMPANY_CODE = :1`,
            [code]
        );

        if (compResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        const company = compResult.rows[0];

        // 테넌트 소속 통계 집계 (사용자 수, 출장 수, 총 지출 금액)
        const statsResult = await executeQuery(
            `SELECT 
                (SELECT COUNT(*) FROM USERS WHERE COMPANY_CODE = :compCode) AS USER_COUNT,
                (SELECT COUNT(*) FROM TRIPS WHERE COMPANY_CODE = :compCode) AS TRIP_COUNT,
                (SELECT NVL(SUM(AMOUNT), 0) FROM EXPENSES WHERE COMPANY_CODE = :compCode) AS TOTAL_EXPENSE_AMOUNT
             FROM DUAL`,
            { compCode: code }
        );

        const stats = statsResult.rows[0] || { USER_COUNT: 0, TRIP_COUNT: 0, TOTAL_EXPENSE_AMOUNT: 0 };

        res.json({
            success: true,
            data: {
                ...company,
                stats: {
                    userCount: Number(stats.USER_COUNT),
                    tripCount: Number(stats.TRIP_COUNT),
                    totalExpenseAmount: Number(stats.TOTAL_EXPENSE_AMOUNT)
                }
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. 신규 회사(테넌트) 등록
router.post('/', async (req, res) => {
    const { companyCode, companyName, businessNo = '', plan = 'standard' } = req.body;

    if (!companyCode || !companyName) {
        return res.status(400).json({ 
            success: false, 
            message: 'companyCode and companyName are required' 
        });
    }

    try {
        const sql = `
            INSERT INTO COMPANIES (COMPANY_CODE, COMPANY_NAME, BUSINESS_NO, PLAN, STATUS)
            VALUES (:1, :2, :3, :4, 'active')
        `;
        await executeQuery(sql, [companyCode.trim().toUpperCase(), companyName.trim(), businessNo, plan]);

        res.status(201).json({
            success: true,
            message: 'Company created successfully',
            data: { companyCode: companyCode.trim().toUpperCase(), companyName, businessNo, plan, status: 'active' }
        });
    } catch (err) {
        if (err.message && err.message.includes('ORA-00001')) {
            return res.status(409).json({ 
                success: false, 
                message: `Company code '${companyCode}' already exists.` 
            });
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. 회사 정보 수정
router.put('/:code', async (req, res) => {
    const { code } = req.params;
    const { companyName, businessNo, plan, status } = req.body;

    try {
        const updateFields = [];
        const binds = [];

        if (companyName !== undefined) {
            binds.push(companyName);
            updateFields.push(`COMPANY_NAME = :${binds.length}`);
        }
        if (businessNo !== undefined) {
            binds.push(businessNo);
            updateFields.push(`BUSINESS_NO = :${binds.length}`);
        }
        if (plan !== undefined) {
            binds.push(plan);
            updateFields.push(`PLAN = :${binds.length}`);
        }
        if (status !== undefined) {
            binds.push(status);
            updateFields.push(`STATUS = :${binds.length}`);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ success: false, message: 'No fields provided for update' });
        }

        binds.push(code);
        const sql = `UPDATE COMPANIES SET ${updateFields.join(', ')} WHERE COMPANY_CODE = :${binds.length}`;

        const result = await executeQuery(sql, binds);
        if (result.rowsAffected === 0) {
            return res.status(404).json({ success: false, message: 'Company not found' });
        }

        res.json({ success: true, message: 'Company updated successfully' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
