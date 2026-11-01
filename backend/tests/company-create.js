const assert=require('node:assert/strict'),crypto=require('node:crypto');
const db=require('../db'),{hash}=require('../lib/validation'),{createApp}=require('../server');
(async()=>{
 const suffix=crypto.randomBytes(6).toString('hex'),ids=['TEST_OWNER_'+suffix,'TEST_OWNER2_'+suffix];
 let server;
 try{
  for(const id of ids)await db.executeQuery("INSERT INTO USERS(UID_VAL,EMAIL,NAME,ROLE) VALUES(:id,:email,'Creation fixture','employee')",{id,email:id+'@example.invalid'});
  if(!process.env.TEST_BASE_URL)server=await new Promise(resolve=>{const s=createApp().listen(0,'127.0.0.1',()=>resolve(s));});
  const base=process.env.TEST_BASE_URL||'http://127.0.0.1:'+server.address().port+'/api';
  async function request(cookie,path,method='GET',body){const res=await fetch(base+path,{method,headers:{Cookie:cookie,Origin:'http://localhost:5173','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:res.status,data:res.status===204?null:await res.json(),cookie:res.headers.get('set-cookie')?.split(';')[0]};}
  async function login(id){const code=crypto.randomBytes(32).toString('base64url');await db.executeQuery('INSERT INTO LOGIN_CODES(TOKEN_HASH,USER_ID,EXPIRES_AT) VALUES(:hash,:id,:expires)',{hash:hash(code),id,expires:Date.now()+60000});const r=await request('','/auth/exchange','POST',{code});assert.equal(r.status,200);return r.cookie;}
  const a=await login(ids[0]),b=await login(ids[1]),name='TEST_COMPANY_'+suffix;
  assert.equal((await request('','/companies','POST',{companyName:name,ownerName:'Owner'})).status,401);
  assert.equal((await request(a,'/companies','POST',{companyName:' ',ownerName:'Owner'})).status,400);
  assert.equal((await request(a,'/companies','POST',{companyName:name,ownerName:'가'.repeat(100)})).status,400);
  assert.equal((await request(a,'/auth/me')).data.data.COMPANY_CODE,null);
  const body={companyName:name,ownerName:'테스트 사장',companyCode:'DEMO_A',userId:'DEMO_A_PRESIDENT',role:'admin'};
  const attempts=await Promise.all([request(a,'/companies','POST',body),request(a,'/companies','POST',body)]);
  assert.deepEqual(attempts.map(r=>r.status).sort(),[201,409]);
  const created=attempts.find(r=>r.status===201).data;
  assert.notEqual(created.data.COMPANY_CODE,'DEMO_A');assert.equal(created.data.UID_VAL,ids[0]);assert.equal(created.data.ROLE,'admin');assert.equal(created.data.NAME,'테스트 사장');
  const second=await request(b,'/companies','POST',{companyName:name,ownerName:'Second'});assert.equal(second.status,201);assert.notEqual(second.data.data.COMPANY_CODE,created.data.COMPANY_CODE);
  const me=await request(a,'/auth/me');assert.equal(me.data.data.ROLE,'admin');assert.equal(me.data.data.COMPANY_CODE,created.data.COMPANY_CODE);
  assert.equal((await request(a,'/companies','POST',body)).status,409);
  const companies=await request(a,'/companies');assert.equal(companies.data.data.length,1);assert.equal(companies.data.data[0].COMPANY_NAME,name);
  assert.equal((await request(a,'/companies/'+second.data.data.COMPANY_CODE+'/invites','POST',{})).status,403);
  const invite=await request(a,'/companies/'+created.data.COMPANY_CODE+'/invites','POST',{});assert.equal(invite.status,201);
  assert.equal((await request(a,'/trips')).status,200);
  console.log('PASS: company creation, validated fields, concurrent duplicate rejection, server-owned identity/code/role, same-name isolation, session restoration, invite privileges');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  for(const id of ids){const row=(await db.executeQuery('SELECT COMPANY_CODE FROM USERS WHERE UID_VAL=:id',{id})).rows[0];if(row?.COMPANY_CODE){await db.executeQuery('DELETE FROM COMPANY_INVITES WHERE COMPANY_CODE=:code',{code:row.COMPANY_CODE});await db.executeQuery('DELETE FROM COMPANIES WHERE COMPANY_CODE=:code',{code:row.COMPANY_CODE});}await db.executeQuery('DELETE FROM USERS WHERE UID_VAL=:id',{id});}
  await(await db.initializePool()).close(0);
 }
})().catch(e=>{console.error(e.message);process.exit(1)});
