const express = require('express');
const router = express.Router();
const { executeQuery } = require('../db');

// 1. 전체 사용자 목록 조회 (회사코드별 필터링 지원)
router.get('/', async (req, res) => {
    const { companyCode, role } = req.query;
    let sql = `SELECT UID_VAL, EMAIL, NAME, ROLE, COMPANY_CODE, TEAM_CODE, CREATED_AT FROM USERS WHERE 1=1`;
    const binds = [];

    if (companyCode) {
        binds.push(companyCode);
        sql += ` AND COMPANY_CODE = :${binds.length}`;
    }
    if (role) {
        binds.push(role);
        sql += ` AND ROLE = :${binds.length}`;
    }

    sql += ` ORDER BY CREATED_AT DESC`;

    try {
        const result = await executeQuery(sql, binds);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. 특정 사용자 조회
router.get('/:uid', async (req, res) => {
    const { uid } = req.params;
    try {
        const result = await executeQuery(
            `SELECT UID_VAL, EMAIL, NAME, ROLE, COMPANY_CODE, TEAM_CODE, CREATED_AT 
             FROM USERS WHERE UID_VAL = :1`,
            [uid]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, message: 'User not found' });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. 사용자 등록 / 생성 (Upsert 지원)
router.post('/', async (req, res) => {
    const { uid, email, name, role = 'employee', companyCode = 'COMP01', teamCode = 'TEAM01' } = req.body;
    
    if (!uid || !email || !name) {
        return res.status(400).json({ success: false, message: 'uid, email, name are required' });
    }

    try {
        const insertSql = `
            INSERT INTO USERS (UID_VAL, EMAIL, NAME, ROLE, COMPANY_CODE, TEAM_CODE)
            VALUES (:1, :2, :3, :4, :5, :6)
        `;
        await executeQuery(insertSql, [uid, email, name, role, companyCode, teamCode]);
        res.json({ success: true, message: 'User created successfully', data: { uid, email, name, role, companyCode, teamCode } });
    } catch (err) {
        if (err.message && err.message.includes('ORA-00001')) {
            try {
                const updateSql = `
                    UPDATE USERS 
                    SET EMAIL = :1, NAME = :2, ROLE = :3, COMPANY_CODE = :4, TEAM_CODE = :5 
                    WHERE UID_VAL = :6
                `;
                await executeQuery(updateSql, [email, name, role, companyCode, teamCode, uid]);
                return res.json({ success: true, message: 'User updated successfully', data: { uid, email, name, role, companyCode, teamCode } });
            } catch (updErr) {
                return res.status(500).json({ success: false, error: updErr.message });
            }
        }
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
