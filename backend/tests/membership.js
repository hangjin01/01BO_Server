const assert=require('node:assert/strict'),crypto=require('node:crypto');
const db=require('../db'),{hash}=require('../lib/validation'),{createApp}=require('../server');
(async()=>{
 const suffix=crypto.randomBytes(6).toString('hex'),company='TEST_M_'+suffix,other='TEST_N_'+suffix;
 const admin='TEST_A_'+suffix,member='TEST_B_'+suffix,newcomer='TEST_C_'+suffix,outsider='TEST_D_'+suffix;
 let server;
 try{
  for(const code of [company,other])await db.executeQuery("INSERT INTO COMPANIES(COMPANY_CODE,COMPANY_NAME,STATUS) VALUES(:code,'Membership fixture','active')",{code});
  for(const [id,role,companyCode]of [[admin,'admin',company],[member,'employee',company],[newcomer,'employee',null],[outsider,'admin',other]])await db.executeQuery('INSERT INTO USERS(UID_VAL,EMAIL,NAME,ROLE,COMPANY_CODE) VALUES(:id,:email,:name,:role,:company)',{id,email:id+'@example.invalid',name:'Fixture',role,company:companyCode});
  if(!process.env.TEST_BASE_URL)server=await new Promise(resolve=>{const s=createApp().listen(0,'127.0.0.1',()=>resolve(s));});
  const base=process.env.TEST_BASE_URL||'http://127.0.0.1:'+server.address().port+'/api';
  async function request(cookie,path,method='GET',body,status=200){const res=await fetch(base+path,{method,headers:{Cookie:cookie,Origin:'http://localhost:5173','Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const data=res.status===204?null:await res.json();assert.equal(res.status,status,JSON.stringify(data));return {res,data};}
  async function login(id){const code=crypto.randomBytes(32).toString('base64url');await db.executeQuery('INSERT INTO LOGIN_CODES(TOKEN_HASH,USER_ID,EXPIRES_AT) VALUES(:hash,:id,:expires)',{hash:hash(code),id,expires:Date.now()+60000});return (await request('','/auth/exchange','POST',{code})).res.headers.get('set-cookie').split(';')[0];}
  const a=await login(admin),m=await login(member),n=await login(newcomer),o=await login(outsider),path='/companies/'+company+'/invites';
  assert.equal((await request(n,'/auth/me')).data.data.COMPANY_CODE,null);
  for(const path of ['/trips','/expenses','/check-ins','/users'])await request(n,path,'GET',undefined,403);
  await request(m,path,'POST',{},403);await request(o,path,'GET',undefined,403);
  const issued=await request(a,path,'POST',{},201),code=issued.data.code;
  const list=(await request(a,path)).data.data;assert.equal(list.length,1);assert.equal(list[0].id,hash(code));assert.ok(!JSON.stringify(list).includes(code));
  const preview=await request(n,'/companies/invites/preview','POST',{code});assert.equal(preview.data.data.COMPANY_CODE,company);
  await request(n,'/companies/invites/preview','POST',{code:company},400);
  await request(a,'/companies/join','POST',{code},409);assert.equal((await request(a,'/auth/me')).data.data.ROLE,'admin');
  await request(o,'/companies/join','POST',{code},409);
  await request(o,path+'/'+hash(code),'DELETE',undefined,403);
  await request(a,path+'/'+hash(code),'DELETE',undefined,204);
  await request(n,'/companies/invites/preview','POST',{code},400);await request(n,'/companies/join','POST',{code},400);
  const expired=(await request(a,path,'POST',{},201)).data.code;
  await db.executeQuery('UPDATE COMPANY_INVITES SET EXPIRES_AT=0 WHERE TOKEN_HASH=:hash',{hash:hash(expired)});
  await request(n,'/companies/invites/preview','POST',{code:expired},400);await request(n,'/companies/join','POST',{code:expired},400);
  const fresh=(await request(a,path,'POST',{},201)).data.code;
  const joined=await request(n,'/companies/join','POST',{code:fresh});assert.equal(joined.data.data.ROLE,'employee');assert.equal(joined.data.data.COMPANY_CODE,company);
  await request(n,'/companies/join','POST',{code:fresh},400);
  assert.equal((await request(n,'/auth/me')).data.data.COMPANY_CODE,company);
  // Same company and same team never grant another employee's trip access.
  await db.executeQuery('UPDATE USERS SET TEAM_CODE=:team WHERE COMPANY_CODE=:company',{team:'TEST_TEAM_'+suffix,company});
  const trip={id:'TEST_PRIV_'+suffix,title:'Private trip',status:'upcoming',startDate:'2026-09-27',endDate:'2026-09-28',destination:'Tokyo',itineraryJson:[],isSharedWithTeam:true};
  await request(m,'/trips','POST',trip,201);
  assert.equal((await request(a,'/trips')).data.data.length,1);
  assert.equal((await request(n,'/trips')).data.data.length,0);
  await request(n,'/trips/'+trip.id,'GET',undefined,404);
  await request(n,'/trips/'+trip.id+'/summary','GET',undefined,404);
  await request(n,'/users/'+member,'GET',undefined,404);
  await db.executeQuery("UPDATE USERS SET ROLE='manager' WHERE UID_VAL=:id",{id:newcomer});
  await request(n,'/trips/'+trip.id,'GET',undefined,404);
  assert.equal((await request(n,'/trips?userId='+member)).data.data.length,0);
  await request(m,'/trips/'+trip.id,'DELETE',undefined,204);
  await request(n,'/trips');assert.equal((await request(a,path)).data.data.length,0);
  console.log('PASS: unassigned onboarding isolation, admin scope, preview, expiry, revocation, one-time consumption, role preservation, company transfer refusal, session refresh');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  for(const code of [company,other])await db.executeQuery('DELETE FROM COMPANY_INVITES WHERE COMPANY_CODE=:company',{company:code});
  for(const id of [admin,member,newcomer,outsider])await db.executeQuery('DELETE FROM USERS WHERE UID_VAL=:id',{id});
  for(const code of [company,other])await db.executeQuery('DELETE FROM COMPANIES WHERE COMPANY_CODE=:company',{company:code});
  await(await db.initializePool()).close(0);
 }
})().catch(error=>{console.error(error.message);process.exit(1)});
