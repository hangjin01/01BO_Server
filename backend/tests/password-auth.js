const assert=require('node:assert/strict'),crypto=require('node:crypto');
const db=require('../db'),{createApp}=require('../server'),pw=require('../lib/password');
(async()=>{
 const suffix=crypto.randomBytes(6).toString('hex'),email='auth_'+suffix+'@example.invalid',email2='auth2_'+suffix+'@example.invalid',legacy='legacy_'+suffix+'@example.invalid';
 const password=crypto.randomBytes(24).toString('base64url'),wrong=crypto.randomBytes(24).toString('base64url');
 let server;const emails=[email,email2,legacy];
 try{
  if(!process.env.TEST_BASE_URL)server=await new Promise(resolve=>{const s=createApp().listen(0,'127.0.0.1',()=>resolve(s));});
  const base=process.env.TEST_BASE_URL||'http://127.0.0.1:'+server.address().port+'/api';
  async function request(path,method='GET',body,status=200,auth={}){
   const res=await fetch(base+path,{method,headers:{Origin:'http://localhost:5173','Content-Type':'application/json',...auth},body:body===undefined?undefined:JSON.stringify(body)});
   const data=res.status===204?null:await res.json();assert.equal(res.status,status,path+' '+JSON.stringify(data));
   if(data)assert.ok(!JSON.stringify(data).includes('PASSWORD_HASH'));
   return {data,cookie:res.headers.get('set-cookie'),res};
  }
  await request('/auth/register','POST',{email,password:'short',name:'Fixture'},400);
  const registered=await request('/auth/register','POST',{email:email.toUpperCase(),password,name:'비밀번호 테스트',role:'admin',companyCode:'DEMO_A'},201);
  const id=registered.data.data.UID_VAL,cookie=registered.cookie.split(';')[0];
  assert.equal(registered.data.data.ROLE,'employee');assert.equal(registered.data.data.COMPANY_CODE,null);assert.equal(registered.data.data.EMAIL,email);assert.equal(registered.data.sessionToken,undefined);
  assert.match(registered.cookie,/; Secure/);assert.match(registered.cookie,/; HttpOnly/);assert.match(registered.cookie,/SameSite=Lax/);
  const stored=(await db.executeQuery('SELECT PASSWORD_HASH FROM AUTH_CREDENTIALS WHERE USER_ID=:id',{id})).rows[0];assert.notEqual(stored.PASSWORD_HASH,password);assert.ok(await pw.verify(password,stored.PASSWORD_HASH));
  await request('/auth/register','POST',{email,password,name:'Duplicate'},409);
  await db.executeQuery("INSERT INTO USERS(UID_VAL,EMAIL,NAME,ROLE) VALUES(:id,:email,'Legacy fixture','admin')",{id:'TEST_LEGACY_'+suffix,email:legacy});
  await request('/auth/register','POST',{email:legacy,password,name:'Takeover'},409);
  await request('/trips','GET',undefined,403,{Cookie:cookie});
  await request('/auth/me','GET',undefined,200,{Cookie:cookie});
  await request('/auth/logout','POST',{},204,{Cookie:cookie});
  await request('/auth/me','GET',undefined,401,{Cookie:cookie});
  for(let i=0;i<5;i++)await request('/auth/login','POST',{email,password:wrong},401);
  await request('/auth/login','POST',{email,password},401);
  await db.executeQuery('UPDATE AUTH_CREDENTIALS SET LOCKED_UNTIL=:until WHERE USER_ID=:id',{until:Date.now()-1,id});
  const login=await request('/auth/login','POST',{email,password});const newCookie=login.cookie.split(';')[0];assert.notEqual(newCookie,cookie);
  const native=await request('/auth/login','POST',{email,password,sessionMode:'native'},200,{Cookie:newCookie});
  assert.equal(native.cookie,null);assert.match(native.data.sessionToken,/^[a-f0-9]{64}$/);
  await request('/auth/me','GET',undefined,401,{Cookie:newCookie});
  const bearer={Authorization:'Bearer '+native.data.sessionToken};
  await request('/auth/me','GET',undefined,200,bearer);
  await request('/auth/logout','POST',{},204,bearer);await request('/auth/me','GET',undefined,401,bearer);
  const again=await request('/auth/login','POST',{email,password,sessionMode:'native'});
  await db.executeQuery('UPDATE APP_SESSIONS SET EXPIRES_AT=0 WHERE USER_ID=:id',{id});
  await request('/auth/me','GET',undefined,401,{Authorization:'Bearer '+again.data.sessionToken});
  const second=await request('/auth/register','POST',{email:email2,password,name:'Second'},201);
  const hash2=(await db.executeQuery('SELECT PASSWORD_HASH FROM AUTH_CREDENTIALS WHERE USER_ID=:id',{id:second.data.data.UID_VAL})).rows[0].PASSWORD_HASH;
  assert.notEqual(hash2,stored.PASSWORD_HASH);
  // Concurrent signup must create one identity and roll back the duplicate user row.
  const statuses=await Promise.all([1,2].map(()=>fetch(base+'/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:'race_'+email,password,name:'Race'})}).then(r=>r.status)));
  emails.push('race_'+email);assert.deepEqual(statuses.sort(),[201,409]);
  const count=(await db.executeQuery('SELECT COUNT(*) CNT FROM USERS WHERE EMAIL=:email',{email:'race_'+email})).rows[0].CNT;assert.equal(count,1);
  console.log('PASS: register/login, hashed passwords with unique salts, identity/role binding, duplicate and legacy protection, lockout recovery, web/native sessions, logout, expiry, concurrent rollback');
 }finally{
  if(server)await new Promise(resolve=>server.close(resolve));
  for(const email of emails)await db.executeQuery('DELETE FROM USERS WHERE EMAIL=:email',{email});
  await(await db.initializePool()).close(0);
 }
})().catch(error=>{console.error(error.message);process.exit(1)});
