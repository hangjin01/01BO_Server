const assert=require('node:assert/strict'),crypto=require('node:crypto');
const db=require('../db'),{createApp}=require('../server'),{hash}=require('../lib/validation');
(async()=>{
 const users=(await db.executeQuery('SELECT UID_VAL,NAME,ROLE,COMPANY_CODE FROM USERS WHERE NAME IN (:a,:b)',{a:'노진아',b:'김행진'})).rows;
 assert.equal(users.length,2);const employee=users.find(u=>u.NAME==='노진아'),boss=users.find(u=>u.NAME==='김행진');
 const before=(await db.executeQuery('SELECT * FROM TRIPS WHERE COMPANY_CODE=:c ORDER BY ID',{c:employee.COMPANY_CODE})).rows;
 const tripId=crypto.randomUUID(),requestId=crypto.randomUUID(),hashes=[],tokens=new Map();let server,sent=0;const drafts=[];
 try{
  for(const u of users){const token=crypto.randomBytes(32).toString('hex');hashes.push(hash(token));tokens.set(u.NAME,token);await db.executeQuery('INSERT INTO APP_SESSIONS(TOKEN_HASH,USER_ID,EXPIRES_AT) VALUES(:h,:actorUid,:exp)',{h:hash(token),actorUid:u.UID_VAL,exp:Date.now()+600000});}
  await db.executeQuery('INSERT INTO TRIPS(ID,USER_ID,TITLE,STATUS,START_DATE,END_DATE,DESTINATION,ITINERARY_JSON,COMPANY_CODE,IS_SHARED_WITH_TEAM) VALUES(:id,:actorUid,:title,:status,:day,:day,:dest,:items,:company,0)',{id:tripId,actorUid:employee.UID_VAL,title:'WORKFLOW_TEST_'+tripId,status:'upcoming',day:'2026-10-01',dest:'東京駅',items:JSON.stringify([{id:'test-event',title:'테스트 일정',locationName:'東京駅',date:'2026-10-01',scheduledTime:'10:00',coords:{latitude:35.6812,longitude:139.7671}}]),company:employee.COMPANY_CODE});
  server=await new Promise(resolve=>{const s=createApp({workflow:{search:async()=>[{name:'東京駅',address:'東京都千代田区',coords:{latitude:35.6812,longitude:139.7671}}],mail:{configured:()=>true,smtp:async row=>{sent++;assert.equal(row.RECIPIENT,'qa@example.invalid');assert.ok(row.CONTENT.includes('방문 완료 여부 확인 불가'));return {accepted:[row.RECIPIENT]};}}}}).listen(0,'127.0.0.1',()=>resolve(s));});
  const call=async(name,path,body)=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+tokens.get(name),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,data:r.headers.get('content-type')?.includes('application/json')?await r.json():Buffer.from(await r.arrayBuffer())};};
  assert.equal((await call('노진아','/places/search?q=Tokyo')).data.places.length,1);
  const payload={tripId,date:'2026-10-01',requestId};const report=await call('노진아','/agent/reports',payload);assert.equal(report.status,200);assert.ok(report.data.content.includes('¥0'));
  assert.deepEqual(await call('노진아','/agent/reports',payload),report);
  assert.equal((await call('김행진','/agent/reports',{...payload,requestId:crypto.randomUUID()})).status,404);
  const doc=await call('노진아','/agent/reports/'+report.data.id+'/docx');assert.equal(doc.status,200);assert.equal(doc.data.subarray(0,2).toString(),'PK');
  assert.equal((await call('김행진','/agent/reports/'+report.data.id+'/docx')).status,404);
  assert.equal((await call('노진아','/agent/reports/'+report.data.id+'/email-preview',{recipient:'bad\r\nBcc: leak@example.invalid'})).status,400);
  const draft=await call('노진아','/agent/reports/'+report.data.id+'/email-preview',{recipient:'qa@example.invalid'});assert.equal(draft.status,200);assert.equal(sent,0);drafts.push(draft.data.id);
  assert.equal((await call('김행진','/agent/emails/'+draft.data.id+'/send',{confirm:true})).status,404);
  assert.equal((await call('노진아','/agent/emails/'+draft.data.id+'/send',{})).status,400);
  const results=await Promise.all([call('노진아','/agent/emails/'+draft.data.id+'/send',{confirm:true}),call('노진아','/agent/emails/'+draft.data.id+'/send',{confirm:true})]);assert.ok(results.some(r=>r.status===200));assert.equal(sent,1);
  assert.equal((await call('노진아','/agent/emails/'+draft.data.id+'/send',{confirm:true})).status,200);assert.equal(sent,1);
  assert.equal((await call('김행진','/agent/emails')).data.emails.some(e=>e.id===draft.data.id),false);
  const second=await call('노진아','/agent/reports/'+report.data.id+'/email-preview',{recipient:'qa@example.invalid'});
  await assert.rejects(()=>require('../lib/mail').send(employee,second.data.id,{configured:()=>true,smtp:async()=>{throw new Error('simulated uncertain send');}}),e=>e.status===502);
  assert.equal((await call('노진아','/agent/emails/'+second.data.id+'/send',{confirm:true})).status,409);assert.equal(sent,1);
  console.log('PASS: place response, own report creation/download, report idempotency, boss cannot access/send employee report, email preview, header injection rejection, confirmation, concurrent/replayed send once, uncertain send blocked. No external email sent.');
 }finally{
  if(server)await new Promise(r=>server.close(r));
  await db.executeQuery('DELETE FROM AGENT_REQUESTS WHERE USER_ID=:actorUid AND REQUEST_ID=:rid',{actorUid:employee.UID_VAL,rid:requestId});
  await db.executeQuery('DELETE FROM TRIPS WHERE ID=:id',{id:tripId});
  for(const h of hashes)await db.executeQuery('DELETE FROM APP_SESSIONS WHERE TOKEN_HASH=:h',{h});
  assert.deepEqual((await db.executeQuery('SELECT * FROM TRIPS WHERE COMPANY_CODE=:c ORDER BY ID',{c:employee.COMPANY_CODE})).rows,before);
  console.log('PASS: fixtures cleaned and existing trips unchanged.');await(await db.initializePool()).close(0);
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
