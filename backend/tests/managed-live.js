// Run only with explicit authorization to send these named test users' trip data
// to OpenAI. Logs contain outcomes, never API keys, tokens, or trip contents.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
const db=require('../db'),{hash}=require('../lib/validation');
(async()=>{
 if(process.env.O1BO_APPROVED_LIVE_TEST!=='yes')throw new Error('Explicit real-data test approval is required.');
 const users=(await db.executeQuery('SELECT UID_VAL,NAME,ROLE,COMPANY_CODE FROM USERS WHERE NAME IN (:a,:b)',{a:'김행진',b:'노진아'})).rows;
 assert.equal(users.length,2);assert.equal(users[0].COMPANY_CODE,users[1].COMPANY_CODE);
 const cid=crypto.randomUUID(),tokens=new Map(),hashes=[];
 const before=(await db.executeQuery('SELECT * FROM TRIPS WHERE COMPANY_CODE=:c ORDER BY ID',{c:users[0].COMPANY_CODE})).rows;
 try{
  for(const u of users){const token=crypto.randomBytes(32).toString('hex');hashes.push(hash(token));await db.executeQuery('INSERT INTO APP_SESSIONS(TOKEN_HASH,USER_ID,EXPIRES_AT) VALUES(:h,:actorUid,:exp)',{h:hash(token),actorUid:u.UID_VAL,exp:Date.now()+600000});tokens.set(u.NAME,token);}
  for(const [name,message,status,kind] of [['노진아','내 출장 일정 보여줘',200,'answer'],['김행진','우리 회사 전체 직원 출장 일정 보여줘',200,'answer'],['노진아','우리 회사 전체 직원 출장 일정 보여줘',403,null],['노진아','내 일보를 작성해서 이메일 보내줘',200,'question']]){
   const body={requestId:crypto.randomUUID(),conversationId:cid,language:'ko',message};
   const response=await fetch('http://127.0.0.1:3000/api/agent/messages',{method:'POST',headers:{Authorization:'Bearer '+tokens.get(name),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
   const data=await response.json();console.log(JSON.stringify({name,status:response.status,kind:data.kind||null,hasAnswer:!!data.message,changed:!!data.changed,...(response.status>=500?{error:data.message}:{})}));
   assert.equal(response.status,status,'Unexpected response status');if(kind)assert.equal(data.kind,kind);assert.ok(data.message);assert.ok(!data.changed);
   if(status===200){const replay=await fetch('http://127.0.0.1:3000/api/agent/messages',{method:'POST',headers:{Authorization:'Bearer '+tokens.get(name),'Content-Type':'application/json'},body:JSON.stringify(body)});assert.deepEqual(await replay.json(),data);}
  }
  console.log('PASS: actual managed agent, own/company read, employee denial, missing email details clarification, idempotent replay.');
 }finally{
  for(const u of users)await db.executeQuery('DELETE FROM AGENT_REQUESTS WHERE USER_ID=:actorUid AND CONVERSATION_ID=:cid',{actorUid:u.UID_VAL,cid});
  for(const h of hashes)await db.executeQuery('DELETE FROM APP_SESSIONS WHERE TOKEN_HASH=:h',{h});
  const after=(await db.executeQuery('SELECT * FROM TRIPS WHERE COMPANY_CODE=:c ORDER BY ID',{c:users[0].COMPANY_CODE})).rows;assert.deepEqual(after,before);
  console.log('PASS: existing trips unchanged; temporary app sessions and request records removed.');await(await db.initializePool()).close(0);
 }
})().catch(e=>{console.error(e.message);process.exitCode=1});
