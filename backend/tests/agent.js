// Real Oracle/API execution with deterministic provider doubles. This does not
// claim to validate live Gemini language understanding or geocoder availability.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const db=require('../db'),{hash}=require('../lib/validation'),{createApp}=require('../server');
(async()=>{
 const cid=crypto.randomUUID(),prefix='AGENT_TEST_'+crypto.randomBytes(5).toString('hex');
 const users=(await db.executeQuery('SELECT UID_VAL,NAME,ROLE,COMPANY_CODE FROM USERS WHERE NAME IN (:a,:b)',{a:'노진아',b:'김행진'})).rows;
 assert.equal(users.length,2,'Expected exactly the two user-provided test accounts');
 const employee=users.find(u=>u.NAME==='노진아'),boss=users.find(u=>u.NAME==='김행진');
 assert.equal(employee.ROLE,'employee');assert.equal(boss.ROLE,'admin');assert.equal(employee.COMPANY_CODE,boss.COMPANY_CODE);
 const sessions=[],created=[],commands=new Map();let server,calls=0;
 const before=(await db.executeQuery('SELECT * FROM TRIPS WHERE COMPANY_CODE=:company ORDER BY ID',{company:boss.COMPANY_CODE})).rows;
 try{
  const tokens={};for(const u of users){const token=crypto.randomBytes(32).toString('hex');sessions.push(hash(token));await db.executeQuery('INSERT INTO APP_SESSIONS(TOKEN_HASH,USER_ID,EXPIRES_AT) VALUES(:hash,:actorUid,:exp)',{hash:hash(token),actorUid:u.UID_VAL,exp:Date.now()+600000});tokens[u.NAME]=token;}
  server=await new Promise(resolve=>{const s=createApp({agent:{maxRequests:100,plan:async context=>{calls++;assert.equal(context.timezone,'Asia/Tokyo');return commands.get(context.message)||{action:'clarify',question:'어느 날짜인가요?'};},search:async location=>[{name:location,address:'東京都千代田区丸の内',coords:{latitude:35.6812,longitude:139.7671}},{name:location+' 다른 출구',address:'東京都千代田区',coords:{latitude:35.6813,longitude:139.7672}}]}}).listen(0,'127.0.0.1',()=>resolve(s));});
  const base='http://127.0.0.1:'+server.address().port+'/api';
  const body=(message,extra={})=>({message,conversationId:cid,requestId:crypto.randomUUID(),language:'ko',...extra});
  async function call(user,b){const r=await fetch(base+'/agent/messages',{method:'POST',headers:{Authorization:'Bearer '+tokens[user],Origin:'http://localhost:5173','Content-Type':'application/json'},body:JSON.stringify(b)});return {status:r.status,data:await r.json()};}
  const putCommand=(message,action)=>commands.set(message,action);
  putCommand('create',{action:'create_event',date:'2026-10-01',time:'14:00',title:prefix,location:'도쿄역',coords:{latitude:0,longitude:0}});
  const chooseBody=body('create'),choose=await call('노진아',chooseBody);assert.equal(choose.status,200,JSON.stringify(choose));assert.equal(choose.data.kind,'places');assert.equal(choose.data.pending,undefined);assert.equal(choose.data.choices.length,2);
  assert.equal((await db.executeQuery('SELECT COUNT(*) CNT FROM TRIPS WHERE TITLE=:title',{title:prefix})).rows[0].CNT,0);
  const saveBody=body('select',{choice:{requestId:chooseBody.requestId,index:0}});
  const saved=await call('노진아',saveBody);assert.equal(saved.status,200,JSON.stringify(saved));created.push(saved.data.tripId);assert.equal(saved.data.changed,true);
  const history=async(name,query='')=>{const r=await fetch(base+'/agent/history?conversationId='+cid+query,{headers:{Authorization:'Bearer '+tokens[name]}});return {status:r.status,data:await r.json()};};
  const restored=await history('노진아');assert.equal(restored.status,200);assert.equal(restored.data.conversationId,cid);assert.equal(restored.data.messages.length,2);
  assert.equal(restored.data.messages[1].requestId,saveBody.requestId);assert.equal(restored.data.messages[1].result.tripId,saved.data.tripId);
  assert.equal(restored.data.messages[0].result.pending,undefined);assert.equal(restored.data.messages[0].result.accessRole,undefined);
  assert.equal((await history('김행진','&userId='+employee.UID_VAL)).data.messages.length,0);
  const invalidHistory=await fetch(base+'/agent/history?conversationId=bad',{headers:{Authorization:'Bearer '+tokens['노진아']}});assert.equal(invalidHistory.status,400);
  console.log('PASS: restored ordered own history, request receipts, boss cannot read employee chat, private tool state omitted, malformed conversation rejected.');
  const afterSave=(await db.executeQuery('SELECT * FROM TRIPS WHERE ID=:id',{id:saved.data.tripId})).rows[0];
  assert.equal(afterSave.USER_ID,employee.UID_VAL);assert.equal(JSON.parse(afterSave.ITINERARY_JSON)[0].coords.latitude,35.6812);
  const callsBefore=calls;const replay=await call('노진아',saveBody);assert.deepEqual(replay,saved);assert.equal(calls,callsBefore);
  assert.equal((await call('노진아',{...saveBody,message:'different'})).status,409);
  assert.equal((await call('노진아',body('select again',{choice:{requestId:chooseBody.requestId,index:0}}))).status,409);
  putCommand('update',{action:'update_event',tripId:saved.data.tripId,itemId:saved.data.itemId,time:'15:00'});
  const changed=await call('노진아',body('update'));assert.equal(changed.status,200,JSON.stringify(changed));
  assert.equal(JSON.parse((await db.executeQuery('SELECT ITINERARY_JSON FROM TRIPS WHERE ID=:id',{id:saved.data.tripId})).rows[0].ITINERARY_JSON)[0].scheduledTime,'15:00');
  assert.equal((await call('김행진',body('update'))).status,404,'Boss cannot mutate employee trip');
  putCommand('company',{action:'list_trips',scope:'company'});
  assert.equal((await call('노진아',body('company'))).status,403);
  assert.ok((await call('김행진',body('company'))).data.message.includes(prefix));
  putCommand('report',{action:'write_report',tripId:saved.data.tripId,date:'2026-10-01'});
  const reportBody=body('report'),report=await call('노진아',reportBody);assert.equal(report.status,200,JSON.stringify(report));assert.equal(report.data.kind,'report');assert.ok(report.data.message.includes('방문 완료 여부 확인 불가'));assert.ok(report.data.message.includes('¥0'));
  await call('노진아',reportBody);
  assert.equal((await db.executeQuery('SELECT COUNT(*) CNT FROM AGENT_REPORTS WHERE TRIP_ID=:id',{id:saved.data.tripId})).rows[0].CNT,1);
  const reports=await fetch(base+'/agent/reports',{headers:{Authorization:'Bearer '+tokens['노진아']}}).then(r=>r.json());assert.ok(reports.reports.some(r=>r.tripId===saved.data.tripId));
  const bossReports=await fetch(base+'/agent/reports',{headers:{Authorization:'Bearer '+tokens['김행진']}}).then(r=>r.json());assert.ok(!bossReports.reports.some(r=>r.tripId===saved.data.tripId));
  putCommand('email',{action:'send_report',tripId:saved.data.tripId,date:'2026-10-01',recipient:'nobody@example.invalid'});
  assert.equal((await call('노진아',body('email'))).data.kind,'email_preview');
  putCommand('bad',{action:'delete_all'});assert.equal((await call('노진아',body('bad'))).status,502);
  putCommand('badtime',{action:'update_event',tripId:saved.data.tripId,itemId:saved.data.itemId,time:'25:90'});assert.equal((await call('노진아',body('badtime'))).status,400);
  const clarification=await call('노진아',body('missing date',{action:{action:'create_event',role:'admin'}}));assert.equal(clarification.data.kind,'question');
  // Independent boss-owned event, then employee must not write it.
  const bossChoice=await call('김행진',body('create'));
  const bossSaveBody=body('select boss',{choice:{requestId:bossChoice.data.requestId,index:1}});
  const concurrent=await Promise.all([call('김행진',bossSaveBody),call('김행진',bossSaveBody)]);
  const success=concurrent.find(r=>r.status===200);assert.ok(success,JSON.stringify(concurrent));created.push(success.data.tripId);
  const bossReplay=await call('김행진',bossSaveBody);assert.deepEqual(bossReplay.data,success.data);
  putCommand('boss-edit',{action:'update_event',tripId:success.data.tripId,itemId:success.data.itemId,time:'16:00'});assert.equal((await call('노진아',body('boss-edit'))).status,404);
  putCommand('own',{action:'list_trips',scope:'own'});const own=await call('노진아',body('own'));assert.equal(own.status,200);
  assert.equal((await db.executeQuery('SELECT COUNT(*) CNT FROM TRIPS WHERE TITLE=:title',{title:prefix})).rows[0].CNT,2);
  if(!process.env.OPENAI_API_KEY){
    const real=await new Promise(resolve=>{const s=createApp().listen(0,'127.0.0.1',()=>resolve(s));});
    try {const response=await fetch('http://127.0.0.1:'+real.address().port+'/api/agent/messages',{method:'POST',headers:{Authorization:'Bearer '+tokens['노진아'],'Content-Type':'application/json'},body:JSON.stringify(body('내일 일정 보여줘'))});assert.equal(response.status,503);assert.ok((await response.json()).message.includes('OpenAI'));}
    finally {await new Promise(resolve=>real.close(resolve));}
  }
  console.log('PASS: 노진아/김행진 company roles, place selection, server-owned coordinates, create/update, own/company access, owner-only writes, report facts, atomic retry/dedupe, concurrent replay, missing mail, invalid tool/time and ignored client action. Provider calls were test doubles.');
 }finally{
  if(server)await new Promise(r=>server.close(r));
  for(const u of users)await db.executeQuery('DELETE FROM AGENT_REQUESTS WHERE USER_ID=:actorUid AND CONVERSATION_ID=:cid',{actorUid:u.UID_VAL,cid});
  // Only exact unique fixture title; cascades this test's daily reports.
  await db.executeQuery('DELETE FROM TRIPS WHERE TITLE=:title AND COMPANY_CODE=:company',{title:prefix,company:boss.COMPANY_CODE});
  for(const token of sessions)await db.executeQuery('DELETE FROM APP_SESSIONS WHERE TOKEN_HASH=:hash',{hash:token});
  const after=(await db.executeQuery('SELECT * FROM TRIPS WHERE COMPANY_CODE=:company ORDER BY ID',{company:boss.COMPANY_CODE})).rows;
  assert.deepEqual(after,before,'Existing company trips must remain unchanged');
  console.log('PASS: test-only trips, agent records and temporary sessions removed; existing company trips unchanged.');
  await(await db.initializePool()).close(0);
 }
})().catch(e=>{console.error(e.message);process.exit(1)});
