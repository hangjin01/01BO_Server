const oracledb = require('oracledb');

// Oracle Thin Mode 사용 (Node-oracledb v6+ 기본 설정)
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.autoCommit = true;
oracledb.fetchAsString = [oracledb.CLOB];

const dbConfig = {
    user: process.env.DB_USER || 'TRIP_USER',
    password: process.env.DB_PASSWORD || 'trippassword123!',
    connectString: process.env.DB_CONNECT_STRING || 'db:1521/XEPDB1',
    poolMin: 1,
    poolMax: 10,
    poolIncrement: 1,
    poolTimeout: 60
};

let pool;

async function initializePool() {
    try {
        pool = await oracledb.createPool(dbConfig);
        console.log('Oracle Database Connection Pool created successfully.');
    } catch (err) {
        console.error('Failed to create Oracle DB pool:', err.message);
    }
}

async function executeQuery(sql, binds = [], options = {}) {
    let connection;
    try {
        if (!pool) {
            await initializePool();
        }
        connection = await pool.getConnection();
        const result = await connection.execute(sql, binds, options);
        return result;
    } catch (err) {
        console.error('Oracle Query Execution Error:', err);
        throw err;
    } finally {
        if (connection) {
            try {
                await connection.close();
            } catch (err) {
                console.error('Failed to close connection:', err);
            }
        }
    }
}

module.exports = {
    initializePool,
    executeQuery,
    oracledb
};
