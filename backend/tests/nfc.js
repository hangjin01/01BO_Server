const assert=require('node:assert/strict'),crypto=require('node:crypto'),db=require('../db'),{hash}=require('../lib/validation'),{createApp}=require('../server');
(async()=>{
 const id='NFC_QA_'+crypto.randomBytes(8).toString('hex'),companies=[id,id+'_B'],trip=id+'_trip',users=[id+'_boss',id+'_staff',id+'_other',id+'_peer'],tokens={};let server;
 const tag='o1bo:'+crypto.randomBytes(32).toString('hex'),item={id:'site',title:'NFC test',locationName:'Test site',address:'Test',date:'2026-10-04',scheduledTime:'10:00',coords:{latitude:35,longitude:139}};
 try{
  for(const c of companies)await db.executeQuery("INSERT INTO COMPANIES(COMPANY_CODE,COMPANY_NAME,STATUS) VALUES(:c,'Temporary NFC QA','active')",{c});
  for(const [i,u]of users.entries()){
   await db.executeQuery('INSERT INTO USERS(UID_VAL,EMAIL,NAME,ROLE,COMPANY_CODE) VALUES(:id,:email,:name,:role,:c)',{id:u,email:u+'@example.invalid',name:u,role:i===0||i===2?'admin':'employee',c:i===2?companies[1]:companies[0]});
   tokens[u]=crypto.randomBytes(32).toString('hex');await db.executeQuery('INSERT INTO APP_SESSIONS(TOKEN_HASH,USER_ID,EXPIRES_AT) VALUES(:h,:u,:exp)',{h:hash(tokens[u]),u,exp:Date.now()+600000});
  }
  await db.executeQuery("INSERT INTO TRIPS(ID,USER_ID,TITLE,STATUS,START_DATE,END_DATE,DESTINATION,ITINERARY_JSON,COMPANY_CODE,IS_SHARED_WITH_TEAM) VALUES(:id,:u,'NFC QA','ongoing','2026-10-04','2026-10-04','Test',:items,:c,0)",{id:trip,u:users[1],items:JSON.stringify([item,{...item,id:'no-tag'}]),c:companies[0]});
  server=await new Promise(resolve=>{const s=createApp().listen(0,'127.0.0.1',()=>resolve(s));});
  async function call(i,path,method='GET',body){const r=await fetch('http://127.0.0.1:'+server.address().port+'/api'+path,{method,headers:{Authorization:'Bearer '+tokens[users[i]],'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:r.status===204?{}:await r.json()};}
  const policy=(i,enabled)=>call(i,'/nfc/policy','PUT',{enabled});
  assert.equal((await call(1,'/nfc/policy')).body.enabled,false);
  assert.equal((await policy(1,true)).status,403);assert.equal((await policy(0,true)).status,409);
  assert.equal((await call(2,'/nfc/tags','POST',{tripId:trip,itemId:item.id,tagId:tag})).status,404);
  assert.equal((await call(0,'/nfc/tags','POST',{tripId:trip,itemId:item.id,tagId:tag})).status,201);
  assert.equal((await policy(0,true)).status,200);
  assert.equal((await call(1,'/nfc/requirement?tripId='+trip+'&itemId=no-tag')).body.required,false);
  assert.equal((await call(0,'/nfc/tags/'+hash(tag),'DELETE')).status,409);
  const payload={tripId:trip,itineraryItemId:item.id,lat:35,lng:139,typeVal:'check-in',nfcTagId:tag,locationAccuracy:10,locationTimestamp:Date.now()};
  const check=(p,i=1)=>call(i,'/check-ins','POST',p);
  assert.equal((await check({...payload,nfcTagId:'manual',verified:true})).status,422);
  assert.equal((await check(payload)).status,400);
  const challenge=(typeVal='check-in')=>call(1,'/nfc/challenge','POST',{tripId:trip,itemId:item.id,typeVal});
  let token=(await challenge()).body.token;
  assert.equal((await check({...payload,nfcChallenge:token,lat:34})).status,422);
  assert.equal((await check({...payload,nfcChallenge:token,locationAccuracy:100})).status,422);
  assert.equal((await check({...payload,nfcChallenge:token,locationTimestamp:Date.now()-120000})).status,422);
  assert.equal((await check({...payload,nfcChallenge:token,nfcTagId:'o1bo:'+'f'.repeat(64)})).status,422);
  const ok=await check({...payload,nfcChallenge:token});assert.equal(ok.status,201);assert.equal(ok.body.data.VERIFICATION_METHOD,'nfc_gps');assert.equal(ok.body.data.VERIFIED,1);assert.notEqual(ok.body.data.NFC_TAG_ID,tag);
  assert.equal((await check({...payload,nfcChallenge:token})).status,409);
  assert.equal((await check({...payload,typeVal:'check-out',nfcTagId:'manual'})).status,422);
  token=(await challenge('check-out')).body.token;
  const concurrent=await Promise.all([check({...payload,typeVal:'check-out',nfcChallenge:token}),check({...payload,typeVal:'check-out',nfcChallenge:token})]);assert.deepEqual(concurrent.map(x=>x.status).sort(),[201,409]);
  assert.equal((await call(0,'/check-ins?tripId='+trip)).body.data.length,2);
  assert.equal((await call(2,'/check-ins?tripId='+trip)).body.data.length,0);
  assert.equal((await call(3,'/check-ins?tripId='+trip)).body.data.length,0);
  assert.equal((await policy(0,false)).status,200);
  assert.equal((await check({...payload,itineraryItemId:'no-tag',nfcTagId:'manual'})).body.data.VERIFICATION_METHOD,'gps');
  console.log('PASS NFC: admin-only policy, tag registration/isolation, required check-in/out, invalid tag/GPS/freshness, single-use concurrent submission, boss-only peer visibility, GPS fallback.');
 }finally{
  if(server)await new Promise(r=>server.close(r));
  await db.executeQuery('DELETE FROM CHECK_INS WHERE TRIP_ID=:id',{id:trip});
  await db.executeQuery('DELETE FROM TRIPS WHERE ID=:id',{id:trip});
  for(const c of companies)await db.executeQuery('DELETE FROM COMPANY_NFC_POLICY WHERE COMPANY_CODE=:c',{c});
  for(const u of users)await db.executeQuery('DELETE FROM USERS WHERE UID_VAL=:id',{id:u});
  for(const c of companies)await db.executeQuery('DELETE FROM COMPANIES WHERE COMPANY_CODE=:c',{c});
  await(await db.initializePool()).close(0);console.log('Temporary NFC fixtures removed.');
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
