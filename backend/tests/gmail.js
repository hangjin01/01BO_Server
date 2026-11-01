// Isolated OAuth tests: no production DB, Google requests, or emails.
const assert=require('node:assert/strict'),crypto=require('node:crypto');
process.env.O1BO_GOOGLE_CLIENT_ID='test.apps.googleusercontent.com';
process.env.O1BO_GOOGLE_CLIENT_SECRET='test-secret';
process.env.O1BO_GOOGLE_REDIRECT_URI='http://localhost:5173/api/gmail/callback';
process.env.O1BO_TOKEN_KEY=crypto.randomBytes(32).toString('base64');
const db=require('../db');let state,connection,company='COMP_TEST',calls=0;
const user={UID_VAL:'USER_TEST',COMPANY_CODE:company};
const query=async(sql,b={})=>{
 if(sql.startsWith('SELECT COMPANY_CODE'))return {rows:[{COMPANY_CODE:company}]};
 if(sql.startsWith('DELETE FROM GMAIL_OAUTH_STATES')){state=null;return {};}
 if(sql.startsWith('INSERT INTO GMAIL_OAUTH_STATES')){state={STATE_HASH:b.h,USER_ID:b.actorUid,COMPANY_CODE:b.company,VERIFIER:b.verifier,EXPIRES_AT:b.exp,STAGE:b.stage};return {};}
 if(sql.startsWith('SELECT * FROM GMAIL_OAUTH_STATES'))return {rows:state?.STATE_HASH===b.h?[{...state}]:[]};
 if(sql.startsWith('UPDATE GMAIL_OAUTH_STATES')){state.STAGE='started';return {};}
 if(sql.startsWith('DELETE FROM GMAIL_CONNECTIONS')){connection=null;return {};}
 if(sql.startsWith('INSERT INTO GMAIL_CONNECTIONS')){connection={USER_ID:b.actorUid,COMPANY_CODE:b.company,EMAIL:b.email,TOKEN_CIPHER:b.cipher};return {};}
 if(sql.startsWith('SELECT * FROM GMAIL_CONNECTIONS'))return {rows:connection?.USER_ID===b.actorUid&&connection?.COMPANY_CODE===b.company?[connection]:[]};
 throw new Error('Unexpected test query');
};
db.executeQuery=query;db.transaction=async fn=>fn(query);
const gmail=require('../lib/gmail');const routes={};gmail.mountPublic({get:(path,fn)=>routes[path]=fn});
function response(){return {code:200,headers:{},set(k,v){this.headers[k]=v;return this;},cookie(k,v){this.cookieValue=v;return this;},clearCookie(){return this;},redirect(url){this.location=url;return this;},type(){return this;},send(body){this.body=body;return this;},status(n){this.code=n;return this;}};}
global.fetch=async(url,options)=>{
 calls++;
 if(url==='https://oauth2.googleapis.com/token'){
  assert.equal(options.body.get('code_verifier').length,43);
  return {ok:true,json:async()=>({access_token:'fake-access',refresh_token:'fake-refresh',scope:'openid email https://www.googleapis.com/auth/gmail.send'})};
 }
 assert.equal(url,'https://openidconnect.googleapis.com/v1/userinfo');
 return {ok:true,json:async()=>({email:'qa@example.invalid',email_verified:true})};
};
(async()=>{
 const encrypted=gmail.encrypt('sample-token');assert.equal(gmail.decrypt(encrypted),'sample-token');
 assert.notEqual(encrypted,gmail.encrypt('sample-token'));
 const tampered=Buffer.from(encrypted,'base64');tampered[15]^=1;assert.throws(()=>gmail.decrypt(tampered.toString('base64')));
 const ticket=new URL((await gmail.begin(user)).url).searchParams.get('ticket');
 assert.notEqual(state.STATE_HASH,ticket);assert.notEqual(state.VERIFIER,'fake-refresh');
 const launch=response();await routes['/api/gmail/launch']({query:{ticket}},launch);
 const auth=new URL(launch.location);assert.equal(auth.origin,'https://accounts.google.com');assert.equal(auth.searchParams.get('code_challenge_method'),'S256');assert.ok(!auth.searchParams.get('scope').includes('gmail.readonly'));
 await assert.rejects(()=>routes['/api/gmail/launch']({query:{ticket}},response()));
 const invalid=response();await routes['/api/gmail/callback']({query:{state:ticket,code:'fake-code'},headers:{cookie:'o1bo_gmail_state=wrong'}},invalid);
 assert.equal(invalid.code,400);assert.equal(calls,0);
 const valid=response();await routes['/api/gmail/callback']({query:{state:ticket,code:'fake-code'},headers:{cookie:'o1bo_gmail_state='+ticket}},valid);
 assert.equal(valid.code,200);assert.equal(calls,2);assert.equal(gmail.decrypt(connection.TOKEN_CIPHER),'fake-refresh');
 assert.deepEqual(await gmail.status(user),{configured:true,connected:true,email:'qa@example.invalid'});
 assert.equal((await gmail.status({...user,UID_VAL:'OTHER'})).connected,false);
 assert.equal((await gmail.status({...user,COMPANY_CODE:'OTHER'})).connected,false);
 const replay=response();await routes['/api/gmail/callback']({query:{state:ticket,code:'fake-code'},headers:{cookie:'o1bo_gmail_state='+ticket}},replay);
 assert.equal(replay.code,400);assert.equal(calls,2);
 const next=new URL((await gmail.begin(user)).url).searchParams.get('ticket');
 await routes['/api/gmail/launch']({query:{ticket:next}},response());company='MOVED';
 const moved=response();await routes['/api/gmail/callback']({query:{state:next,code:'fake-code'},headers:{cookie:'o1bo_gmail_state='+next}},moved);
 assert.equal(moved.code,400);assert.equal(connection.COMPANY_CODE,'COMP_TEST');
 console.log('PASS: token encryption/tamper rejection, PKCE, hashed one-time state, cookie mismatch, replay rejection, user/company isolation and membership-change rejection. No network or production DB used.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
