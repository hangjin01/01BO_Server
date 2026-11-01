const crypto = require('node:crypto');
const { executeQuery, transaction } = require('../db');
const { fail, hash } = require('./validation');
const cookieName = 'o1bo_session';
function token(req) {
  const bearer=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization||'');
  if(bearer)return bearer[1];
  return (req.headers.cookie || '').split(';').map(s=>s.trim()).find(s=>s.startsWith(cookieName+'='))?.slice(cookieName.length+1) || '';
}
async function session(req,res,next) {
  const value = token(req);
  if (/^[a-f0-9]{64}$/.test(value)) {
    const result = await executeQuery(`SELECT U.UID_VAL,U.EMAIL,U.NAME,U.ROLE,U.COMPANY_CODE,U.TEAM_CODE FROM USERS U JOIN APP_SESSIONS S ON S.USER_ID=U.UID_VAL LEFT JOIN COMPANIES C ON C.COMPANY_CODE=U.COMPANY_CODE WHERE S.TOKEN_HASH=:token AND S.EXPIRES_AT>:now AND (U.COMPANY_CODE IS NULL OR C.STATUS='active')`, {token:hash(value),now:Date.now()});
    req.user = result.rows[0];
  }
  next();
}
function required(req,res,next) { if (!req.user) fail(401,'로그인이 필요합니다.'); next(); }
function cookieOptions() { return { httpOnly:true, secure:true, sameSite:'lax', path:'/api', maxAge:8*60*60*1000 }; }
async function issueSession(query,req,user) {
 const value=crypto.randomBytes(32).toString('hex'),expiresAt=Date.now()+8*60*60*1000;
 if(token(req))await query('DELETE FROM APP_SESSIONS WHERE TOKEN_HASH=:hash',{hash:hash(token(req))});
 await query('INSERT INTO APP_SESSIONS(TOKEN_HASH,USER_ID,EXPIRES_AT) VALUES(:token,:id,:expires)',{token:hash(value),id:user.UID_VAL,expires:expiresAt});
 return {user,value,expiresAt};
}
function respondSession(req,res,result,status=200) {
 const {user,value,expiresAt}=result;
 if(req.body?.sessionMode==='native')return res.status(status).json({success:true,data:user,sessionToken:value,expiresAt});
 return res.cookie(cookieName,value,cookieOptions()).status(status).json({success:true,data:user,expiresAt});
}
function routes(router) {
  require('./password-routes')(router,{issueSession,respondSession});
  router.get('/me', required, (req,res)=>res.json({success:true,data:req.user}));
  router.post('/exchange',async(req,res)=>{
    if (!req.secure && !['localhost','127.0.0.1','[::1]'].includes(req.hostname)) fail(403,'도메인 설정 전에는 SSH 터널의 localhost로 로그인하세요.');
    const code=req.body.code;
    if (typeof code!=='string'||!/^[-A-Za-z0-9_]{43}$/.test(code)) fail(401,'유효한 일회용 로그인 코드가 필요합니다.');
    const value=crypto.randomBytes(32).toString('hex');
    const user=await transaction(async q=>{
      const r=await q('SELECT USER_ID,EXPIRES_AT FROM LOGIN_CODES WHERE TOKEN_HASH=:hash FOR UPDATE',{hash:hash(code)});
      if(!r.rows[0]||r.rows[0].EXPIRES_AT<=Date.now())fail(401,'로그인 코드가 만료되었거나 사용되었습니다.');
      const u=(await q("SELECT U.* FROM USERS U LEFT JOIN COMPANIES C ON C.COMPANY_CODE=U.COMPANY_CODE WHERE U.UID_VAL=:id AND (U.COMPANY_CODE IS NULL OR C.STATUS='active')",{id:r.rows[0].USER_ID})).rows[0];
      if(!u)fail(403,'사용 가능한 계정이 필요합니다.');
      await q('DELETE FROM LOGIN_CODES WHERE TOKEN_HASH=:hash',{hash:hash(code)});
      await q('INSERT INTO APP_SESSIONS(TOKEN_HASH,USER_ID,EXPIRES_AT) VALUES(:token,:id,:expires)',{token:hash(value),id:u.UID_VAL,expires:Date.now()+8*60*60*1000});
      return u;
    });
    res.cookie(cookieName,value,cookieOptions()).json({success:true,data:user});
  });
  router.post('/logout',async(req,res)=>{if(token(req))await executeQuery('DELETE FROM APP_SESSIONS WHERE TOKEN_HASH=:hash',{hash:hash(token(req))});const {maxAge,...options}=cookieOptions();res.clearCookie(cookieName,options).status(204).end();});
}
module.exports={session,required,routes};
