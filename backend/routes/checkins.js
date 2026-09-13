const express = require('express');
const router = express.Router();
const { executeQuery } = require('../db');

// 1. 체크인 기록 조회 (쿼리: tripId, userId, companyCode)
router.get('/', async (req, res) => {
    const { tripId, userId, companyCode } = req.query;
    let sql = `SELECT ID, USER_ID, TRIP_ID, TS_MILLIS, LOCATION_NAME, LAT, LNG, TYPE_VAL, VERIFIED, ITINERARY_ITEM_ID, COMPANY_CODE, NFC_TAG_ID, CREATED_AT FROM CHECK_INS WHERE 1=1`;
    const binds = {};

    if (tripId) {
        sql += ` AND TRIP_ID = :tripId`;
        binds.tripId = tripId;
    }
    if (userId) {
        sql += ` AND USER_ID = :userId`;
        binds.userId = userId;
    }
    if (companyCode) {
        sql += ` AND COMPANY_CODE = :companyCode`;
        binds.companyCode = companyCode;
    }

    sql += ` ORDER BY TS_MILLIS DESC`;

    try {
        const result = await executeQuery(sql, binds);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. 체크인 / 체크아웃 등록
router.post('/', async (req, res) => {
    const {
        id = `CHECK_${Date.now()}`,
        userId,
        tripId,
        tsMillis = Date.now(),
        locationName,
        lat,
        lng,
        typeVal = 'check-in',
        verified = 1,
        itineraryItemId = null,
        companyCode = 'COMP01',
        nfcTagId = null
    } = req.body;

    if (!userId || !tripId || !locationName) {
        return res.status(400).json({ success: false, message: 'userId, tripId, locationName are required' });
    }

    try {
        const sql = `
            INSERT INTO CHECK_INS (ID, USER_ID, TRIP_ID, TS_MILLIS, LOCATION_NAME, LAT, LNG, TYPE_VAL, VERIFIED, ITINERARY_ITEM_ID, COMPANY_CODE, NFC_TAG_ID)
            VALUES (:id, :userId, :tripId, :tsMillis, :locationName, :lat, :lng, :typeVal, :verified, :itineraryItemId, :companyCode, :nfcTagId)
        `;
        await executeQuery(sql, {
            id,
            userId,
            tripId,
            tsMillis,
            locationName,
            lat: lat ? parseFloat(lat) : null,
            lng: lng ? parseFloat(lng) : null,
            typeVal,
            verified: verified ? 1 : 0,
            itineraryItemId,
            companyCode,
            nfcTagId
        });

        res.json({ success: true, message: 'Check-in recorded successfully', data: { id, userId, tripId, locationName, typeVal } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;
