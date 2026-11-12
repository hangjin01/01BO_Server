const crypto=require('node:crypto');
const {executeQuery:q,transaction}=require('../db');
const v=require('./validation'),pw=require('./password');
module.exports=function passwordRoutes(router,{issueSession,respondSession}){
 // Separate bounded windows prevent login/registration identity floods consuming memory.
 const {createLimiter}=require('./request-security');
 const admitLogin=createLimiter({max:40,windowMs:900000});
 const admitRegister=createLimiter({max:10,windowMs:900000});
 function guard(req,kind){
  if(!req.secure&&!['localhost','127.0.0.1','[::1]'].includes(req.hostname))v.fail(403,'HTTPS 연결에서 로그인해 주세요.');
  if(!(kind==='register'?admitRegister:admitLogin)(req.ip))v.fail(429,'시도 횟수가 많습니다. 15분 후 다시 시도해 주세요.');
  if(![undefined,'web','native'].includes(req.body?.sessionMode))v.fail(400,'Invalid session mode');
 }
 router.post('/register',async(req,res)=>{
  guard(req,'register');
  const email=pw.email(req.body?.email),password=pw.password(req.body?.password),name=v.text(req.body?.name,100,'name');
  const encoded=await pw.makeHash(password),uid='USER_'+crypto.randomUUID();
  const result=await transaction(async query=>{
   // Legacy accounts require an explicit future credential-enrollment flow.
   if((await query('SELECT UID_VAL FROM USERS WHERE LOWER(EMAIL)=:email',{email})).rows.length)v.fail(409,'이 이메일로 가입할 수 없습니다. 기존 계정을 확인해 주세요.');
   await query("INSERT INTO USERS(UID_VAL,EMAIL,NAME,ROLE,COMPANY_CODE,TEAM_CODE) VALUES(:id,:email,:name,'employee',NULL,NULL)",{id:uid,email,name});
   await query('INSERT INTO AUTH_CREDENTIALS(USER_ID,LOGIN_ID,PASSWORD_HASH) VALUES(:id,:email,:passwordHash)',{id:uid,email,passwordHash:encoded});
   const user={UID_VAL:uid,EMAIL:email,NAME:name,ROLE:'employee',COMPANY_CODE:null,TEAM_CODE:null};
   return issueSession(query,req,user);
  });
  respondSession(req,res,result,201);
 });
 router.post('/login',async(req,res)=>{
  guard(req,'login');
  const email=pw.email(req.body?.email),password=pw.password(req.body?.password);
  const stored=(await q('SELECT USER_ID,PASSWORD_HASH FROM AUTH_CREDENTIALS WHERE LOGIN_ID=:email',{email})).rows[0];
  const valid=await pw.verify(password,stored?.PASSWORD_HASH);
  if(!stored)v.fail(401,'아이디 또는 비밀번호가 올바르지 않습니다.');
  const result=await transaction(async query=>{
   const current=(await query('SELECT PASSWORD_HASH,FAILED_ATTEMPTS,LOCKED_UNTIL FROM AUTH_CREDENTIALS WHERE USER_ID=:id FOR UPDATE',{id:stored.USER_ID})).rows[0];
   const now=Date.now();
   if(!current||current.LOCKED_UNTIL>now)return {denied:true};
   if(!valid||current.PASSWORD_HASH!==stored.PASSWORD_HASH){
    const count=(current.LOCKED_UNTIL?0:Number(current.FAILED_ATTEMPTS||0))+1;
    await query('UPDATE AUTH_CREDENTIALS SET FAILED_ATTEMPTS=:count,LOCKED_UNTIL=:until WHERE USER_ID=:id',{count,until:count>=5?now+600000:null,id:stored.USER_ID});
    return {denied:true};
   }
   const user=(await query("SELECT U.UID_VAL,U.EMAIL,U.NAME,U.ROLE,U.COMPANY_CODE,U.TEAM_CODE FROM USERS U LEFT JOIN COMPANIES C ON C.COMPANY_CODE=U.COMPANY_CODE WHERE U.UID_VAL=:id AND (U.COMPANY_CODE IS NULL OR C.STATUS='active')",{id:stored.USER_ID})).rows[0];
   if(!user)return {denied:true};
   await query('UPDATE AUTH_CREDENTIALS SET FAILED_ATTEMPTS=0,LOCKED_UNTIL=NULL WHERE USER_ID=:id',{id:stored.USER_ID});
   return issueSession(query,req,user);
  });
  if(result.denied)v.fail(401,'아이디 또는 비밀번호를 확인해 주세요. 반복 실패 시 10분 뒤 다시 시도해 주세요.');
  respondSession(req,res,result);
 });
};
