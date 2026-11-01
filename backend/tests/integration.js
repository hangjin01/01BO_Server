// Runs against Oracle using disposable, uniquely prefixed fixture records only.
const assert=require('node:assert/strict');const crypto=require('node:crypto');
const db=require('../db');const {hash}=require('../lib/validation');const {createApp}=require('../server');
(async()=>{
 const suffix=crypto.randomBytes(6).toString('hex');const company='TEST_'+suffix,other='TEST_B_'+suffix,uid='TEST_U_'+suffix,uid2='TEST_V_'+suffix,tid='TEST_T_'+suffix;
 let server;
 try {
  for(const code of [company,other])await db.executeQuery("INSERT INTO COMPANIES(COMPANY_CODE,COMPANY_NAME,STATUS) VALUES(:code,'Disposable integration fixture','active')",{code});
  for(const [id,code]of [[uid,company],[uid2,other]])await db.executeQuery("INSERT INTO USERS(UID_VAL,EMAIL,NAME,ROLE,COMPANY_CODE) VALUES(:id,:email,'Integration fixture','employee',:code)",{id,email:id+'@example.invalid',code});
  const seedCode=async id=>{const code=crypto.randomBytes(32).toString('base64url');await db.executeQuery('INSERT INTO LOGIN_CODES(TOKEN_HASH,USER_ID,EXPIRES_AT) VALUES(:hash,:id,:expires)',{hash:hash(code),id,expires:Date.now()+60000});return code;};
  if (!process.env.TEST_BASE_URL) server=await new Promise(resolve=>{const s=createApp().listen(0,'127.0.0.1',()=>resolve(s));});
  const base=process.env.TEST_BASE_URL || 'http://127.0.0.1:'+server.address().port+'/api';
  let cookie='';
  async function request(path,method='GET',body,expected=200,overrideCookie=cookie){const res=await fetch(base+path,{method,headers:{'Content-Type':'application/json',Cookie:overrideCookie,Origin:'http://localhost:5173'},body:body===undefined?undefined:JSON.stringify(body)});const result=res.status===204?null:await res.json();assert.equal(res.status,expected,`${method} ${path}: ${JSON.stringify(result)}`);return {res,result};}
  await request('/health');await request('/trips','GET',undefined,401);
  const code=await seedCode(uid);let login=await request('/auth/exchange','POST',{code});assert.match(login.res.headers.get('set-cookie'), /; Secure/);cookie=login.res.headers.get('set-cookie').split(';')[0];assert.equal(login.result.data.UID_VAL,uid);
  await request('/auth/exchange','POST',{code},401);await request('/auth/me');
  const body={id:tid,userId:uid2,companyCode:other,title:'Trip',status:'upcoming',startDate:'2026-09-25',endDate:'2026-09-26',destination:'Tokyo',itineraryJson:[{id:'one',title:'Site',locationName:'Site',address:'Tokyo',date:'2026-09-25',scheduledTime:'10:00',coords:{latitude:35,longitude:139}}]};
  let r=await request('/trips','POST',body,201);assert.equal(r.result.data.USER_ID,uid);assert.equal(r.result.data.COMPANY_CODE,company);
  await request('/trips/'+tid,'PUT',{...body,title:'Edited',report:'한글 日本語 보고서'});r=await request('/trips/'+tid);assert.equal(r.result.data.TITLE,'Edited');assert.equal(r.result.data.REPORT,'한글 日本語 보고서');
  const longReport='한글'.repeat(20000);
  r=await request('/trips/'+tid,'PUT',{...body,report:longReport});assert.equal(r.result.data.REPORT,longReport);
  await request('/trips/'+tid,'PUT',{...body,status:'active'},400);
  await request('/expenses','POST',{id:'TEST_E_'+suffix,tripId:tid,expenseDate:'2026-09-25',merchant:'Fixture',amount:1200,category:'Meals'},201);
  r=await request('/trips/'+tid+'/summary');assert.equal(r.result.summary.totalExpenseJpy,1200);
  await request('/expenses','POST',{tripId:tid,expenseDate:'2026-09-25',merchant:'Fixture',amount:-1},400);
  r=await request('/check-ins','POST',{tripId:tid,itineraryItemId:'one',lat:0,lng:0,typeVal:'check-in',verified:true},201);assert.equal(r.result.data.VERIFIED,0);
  await request('/check-ins','POST',{tripId:tid,itineraryItemId:'one',lat:35,lng:139,typeVal:'check-out',nfcTagId:'unregistered'},422);
  r=await request('/check-ins','POST',{tripId:tid,itineraryItemId:'one',lat:35,lng:139,typeVal:'check-out',nfcTagId:'manual',verified:true},201);assert.equal(r.result.data.VERIFIED,1);assert.equal(r.result.data.VERIFICATION_METHOD,'gps');
  await request('/check-ins','POST',{tripId:tid,itineraryItemId:'one',lat:35,lng:139,typeVal:'check-out',nfcTagId:'manual'},409);
  const second=await request('/auth/exchange','POST',{code:await seedCode(uid2)});const secondCookie=second.res.headers.get('set-cookie').split(';')[0];
  await request('/trips/'+tid,'GET',undefined,404,secondCookie);await request('/trips/'+tid,'PUT',body,404,secondCookie);await request('/trips/'+tid,'DELETE',undefined,404,secondCookie);
  r=await request('/expenses?companyCode='+company,'GET',undefined,200,secondCookie);assert.equal(r.result.data.length,0);
  await request('/users','POST',{uid:uid2,role:'admin'},403);
  r=await request('/agent/status');assert.equal(typeof r.result.ai,'boolean');assert.equal(r.result.mail,false);
  await request('/trips/'+tid+'/report/email','POST',{recipient:'test@example.invalid',report:'Report'},503);
  await request('/expenses/TEST_E_'+suffix,'DELETE',undefined,204);await request('/trips/'+tid,'DELETE',undefined,204);await request('/trips/'+tid,'GET',undefined,404);
  assert.equal((await db.executeQuery('SELECT COUNT(*) CNT FROM CHECK_INS WHERE TRIP_ID=:id',{id:tid})).rows[0].CNT,0);
  await request('/auth/logout','POST',{},204);await request('/auth/me','GET',undefined,401);
  console.log('PASS: DB readiness, one-time sessions, identity binding, trip CRUD/report persistence, expenses, GPS/NFC, tenant isolation, privilege rejection, unconfigured providers, logout');
 } finally {
  if(server)await new Promise(resolve=>server.close(resolve));
  for(const code of [company,other])await db.executeQuery('DELETE FROM COMPANIES WHERE COMPANY_CODE=:code',{code});
  await (await db.initializePool()).close(0);
 }
})().catch(error=>{console.error(error.message);process.exit(1)});
