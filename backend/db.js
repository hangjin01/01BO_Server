// 연결 준비 상태만 재시도한다. 업무 쓰기/트랜잭션 재실행은 중복 기록을 만들 수 있다.
const oracledb = require('oracledb');
oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;
oracledb.fetchAsString = [oracledb.CLOB];
let pending;
const readySql = 'SELECT 1 FROM USERS WHERE 1=0';
const transient = error => [1109,1033,1034,12514].includes(error.errorNum);
const pause = () => new Promise(resolve => setTimeout(resolve, 2000));
async function createReadyPool() {
  for (let attempt=0; attempt<30; attempt++) {
    let pool, connection;
    try {
      pool = await oracledb.createPool({ user: process.env.DB_USER || 'TRIP_USER', password: process.env.DB_PASSWORD, connectString: process.env.DB_CONNECT_STRING || 'db:1521/XEPDB1', poolMin: 1, poolMax: 10, poolIncrement: 1, poolTimeout: 60 });
      connection = await pool.getConnection();
      await connection.execute(readySql);
      await connection.close();
      return pool;
    } catch (error) {
      if(connection) await connection.close({drop:true}).catch(()=>{});
      if(pool) await pool.close(0).catch(()=>{});
      if(!transient(error) || attempt===29) throw error;
      await pause();
    }
  }
}
async function initializePool() {
  if (!process.env.DB_PASSWORD) throw new Error('DB_PASSWORD is required');
  if (!pending) pending = createReadyPool().catch(error => { pending = null; throw error; });
  return pending;
}
// Validate before any business statement. Never replay writes or transactions.
async function getReadyConnection() {
  const pool = await initializePool();
  for(let attempt=0; attempt<3; attempt++) {
    let connection;
    try {
      connection = await pool.getConnection();
      await connection.execute(readySql);
      return connection;
    } catch(error) {
      if(connection) await connection.close({drop:true}).catch(()=>{});
      if(!transient(error)) throw error;
      if(attempt===2) {
        const unavailable = new Error('데이터베이스 준비 중입니다. 잠시 후 다시 시도해 주세요.');
        unavailable.status=503; throw unavailable;
      }
      await pause();
    }
  }
}
async function executeQuery(sql, binds = {}, options = {}) {
  const connection = await getReadyConnection();
  try { return await connection.execute(sql, binds, { autoCommit: true, ...options }); }
  finally { await connection.close(); }
}
async function transaction(action) {
  const connection = await getReadyConnection();
  const query = (sql, binds = {}) => connection.execute(sql, binds, { autoCommit: false });
  try { const result = await action(query); await connection.commit(); return result; }
  catch (error) { await connection.rollback(); throw error; }
  finally { await connection.close(); }
}
module.exports = { initializePool, executeQuery, transaction, oracledb };
