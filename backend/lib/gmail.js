// Google 토큰은 서버 내부에서만 복호화한다. 연결 완료는 앱 인증과 별개이며 발송 권한만 요청한다.
const crypto=require('node:crypto'),db=require('../db'),v=require('./validation');
const scope='https://www.googleapis.com/auth/gmail.send';
const aad='O1BO Gmail connection v1';
function configured(){return !!(process.env.O1BO_GOOGLE_CLIENT_ID&&process.env.O1BO_GOOGLE_CLIENT_SECRET&&process.env.O1BO_GOOGLE_REDIRECT_URI&&process.env.O1BO_TOKEN_KEY);}
function key(){const k=Buffer.from(process.env.O1BO_TOKEN_KEY||'','base64');if(k.length!==32)v.fail(503,'Gmail 암호화 설정이 필요합니다.');return k;}
function encrypt(text){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',key(),iv);c.setAAD(Buffer.from(aad));return Buffer.concat([iv,c.update(text,'utf8'),c.final(),c.getAuthTag()]).toString('base64');}
function decrypt(text){const b=Buffer.from(text,'base64');if(b.length<28)throw new Error('Invalid encrypted token');const c=crypto.createDecipheriv('aes-256-gcm',key(),b.subarray(0,12));c.setAAD(Buffer.from(aad));c.setAuthTag(b.subarray(-16));return Buffer.concat([c.update(b.subarray(12,-16)),c.final()]).toString('utf8');}
function redirect(){const u=new URL(process.env.O1BO_GOOGLE_REDIRECT_URI);if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))v.fail(503,'Gmail 연결에는 HTTPS 주소가 필요합니다.');if(u.pathname!=='/api/gmail/callback')v.fail(503,'Gmail 리디렉션 주소를 확인해 주세요.');return u;}
async function google(url,body,token){let r;try{r=await fetch(url,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/x-www-form-urlencoded'}:{Authorization:'Bearer '+token},...(body?{body:new URLSearchParams(body)}:{}),signal:AbortSignal.timeout(15000)});}catch{v.fail(502,'Google 연결이 지연되었습니다. 다시 시도해 주세요.');}if(!r.ok)v.fail(502,'Google 연결을 확인해 주세요. 필요하면 Gmail을 다시 연결해 주세요.');return r.json();}
async function connection(user){return(await db.executeQuery('SELECT * FROM GMAIL_CONNECTIONS WHERE USER_ID=:actorUid AND COMPANY_CODE=:company',{actorUid:user.UID_VAL,company:user.COMPANY_CODE})).rows[0];}
async function status(user){const c=configured()?await connection(user):null;return {configured:configured(),connected:!!c,email:c?.EMAIL||null};}
async function begin(user){
 if(!configured())v.fail(503,'Google Cloud OAuth 설정이 필요합니다. 관리자에게 Gmail 연결 설정을 요청해 주세요.');
 const callback=redirect(),state=crypto.randomBytes(32).toString('hex'),verifier=crypto.randomBytes(32).toString('base64url');
 await db.transaction(async q=>{
  const u=(await q('SELECT COMPANY_CODE FROM USERS WHERE UID_VAL=:actorUid FOR UPDATE',{actorUid:user.UID_VAL})).rows[0];if(u?.COMPANY_CODE!==user.COMPANY_CODE)v.fail(409,'회사 소속이 변경되었습니다.');
  await q('DELETE FROM GMAIL_OAUTH_STATES WHERE USER_ID=:actorUid OR EXPIRES_AT<:nowAt',{actorUid:user.UID_VAL,nowAt:Date.now()});
  await q('INSERT INTO GMAIL_OAUTH_STATES(STATE_HASH,USER_ID,COMPANY_CODE,VERIFIER,EXPIRES_AT,STAGE) VALUES(:h,:actorUid,:company,:verifier,:exp,:stage)',{h:v.hash(state),actorUid:user.UID_VAL,company:user.COMPANY_CODE,verifier:encrypt(verifier),exp:Date.now()+600000,stage:'created'});
 });
 return {url:callback.origin+'/api/gmail/launch?ticket='+state};
}
function mountPublic(app){
 app.get('/api/gmail/launch',async(req,res)=>{
  if(!configured())v.fail(503,'Gmail 연결 설정이 필요합니다.');const ticket=v.text(req.query.ticket,64,'ticket');if(!/^[a-f0-9]{64}$/.test(ticket))v.fail(400,'잘못된 연결 요청입니다.');
  const state=await db.transaction(async q=>{const s=(await q('SELECT * FROM GMAIL_OAUTH_STATES WHERE STATE_HASH=:h FOR UPDATE',{h:v.hash(ticket)})).rows[0];if(!s||s.EXPIRES_AT<Date.now()||s.STAGE!=='created')v.fail(400,'연결 요청이 만료되었습니다. 앱에서 다시 연결해 주세요.');await q("UPDATE GMAIL_OAUTH_STATES SET STAGE='started' WHERE STATE_HASH=:h",{h:v.hash(ticket)});return s;});
  const cb=redirect();res.cookie('o1bo_gmail_state',ticket,{httpOnly:true,sameSite:'lax',secure:cb.protocol==='https:',path:'/api/gmail/callback',maxAge:600000});res.set('Referrer-Policy','no-referrer');
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');for(const [k,val]of Object.entries({client_id:process.env.O1BO_GOOGLE_CLIENT_ID,redirect_uri:cb.href,response_type:'code',scope:'openid email '+scope,access_type:'offline',prompt:'consent',state:ticket,code_challenge:crypto.createHash('sha256').update(decrypt(state.VERIFIER)).digest('base64url'),code_challenge_method:'S256'}))url.searchParams.set(k,val);res.redirect(url.href);
 });
 app.get('/api/gmail/callback',async(req,res)=>{
  res.clearCookie('o1bo_gmail_state',{path:'/api/gmail/callback'});res.set('Referrer-Policy','no-referrer');res.set('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'");
  try{
   const state=v.text(req.query.state,64,'state');const cookie=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('o1bo_gmail_state='))?.slice('o1bo_gmail_state='.length);
   if(!/^[a-f0-9]{64}$/.test(state)||cookie!==state)v.fail(400,'연결 요청을 확인할 수 없습니다.');
   const saved=await db.transaction(async q=>{const s=(await q('SELECT * FROM GMAIL_OAUTH_STATES WHERE STATE_HASH=:h FOR UPDATE',{h:v.hash(state)})).rows[0];if(!s||s.EXPIRES_AT<Date.now()||s.STAGE!=='started')v.fail(400,'연결 요청이 만료되었습니다.');await q('DELETE FROM GMAIL_OAUTH_STATES WHERE STATE_HASH=:h',{h:v.hash(state)});return s;});
   if(req.query.error)v.fail(400,'Google 연결이 취소되었습니다.');
   const tokens=await google('https://oauth2.googleapis.com/token',{code:v.text(req.query.code,4096,'code'),client_id:process.env.O1BO_GOOGLE_CLIENT_ID,client_secret:process.env.O1BO_GOOGLE_CLIENT_SECRET,redirect_uri:redirect().href,grant_type:'authorization_code',code_verifier:decrypt(saved.VERIFIER)});
   if(!tokens.refresh_token||!tokens.access_token||!tokens.scope?.split(' ').includes(scope))v.fail(400,'Gmail 발송 권한을 허용한 뒤 다시 연결해 주세요.');
   const info=await google('https://openidconnect.googleapis.com/v1/userinfo',null,tokens.access_token);if(!info.email_verified||typeof info.email!=='string')v.fail(400,'Google 이메일을 확인하지 못했습니다.');
   await db.transaction(async q=>{const u=(await q('SELECT COMPANY_CODE FROM USERS WHERE UID_VAL=:actorUid FOR UPDATE',{actorUid:saved.USER_ID})).rows[0];if(u?.COMPANY_CODE!==saved.COMPANY_CODE)v.fail(409,'회사 소속이 변경되었습니다. 다시 연결해 주세요.');await q('DELETE FROM GMAIL_CONNECTIONS WHERE USER_ID=:actorUid',{actorUid:saved.USER_ID});await q('INSERT INTO GMAIL_CONNECTIONS(USER_ID,COMPANY_CODE,EMAIL,TOKEN_CIPHER) VALUES(:actorUid,:company,:email,:cipher)',{actorUid:saved.USER_ID,company:saved.COMPANY_CODE,email:info.email,cipher:encrypt(tokens.refresh_token)});});
   res.type('html').send('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Gmail 연결 완료</title><h1>Gmail이 연결되었습니다.</h1><p>이 창을 닫거나 휴대폰의 뒤로 가기를 눌러 O1BO 앱으로 돌아가 주세요.</p><p>앱에서 연결 상태가 갱신되지 않으면 연결 상태 새로고침을 눌러 주세요.</p>');
  }catch{res.status(400).type('html').send('<!doctype html><meta charset="utf-8"><title>Gmail 연결 확인</title><h1>Gmail 연결을 완료하지 못했습니다.</h1><p>권한 허용과 Google Cloud 설정을 확인하고 O1BO 앱에서 다시 연결해 주세요.</p>');}
 });
}
async function disconnect(user){const c=await connection(user);await db.transaction(async q=>{await q('SELECT UID_VAL FROM USERS WHERE UID_VAL=:actorUid FOR UPDATE',{actorUid:user.UID_VAL});await q('DELETE FROM GMAIL_CONNECTIONS WHERE USER_ID=:actorUid',{actorUid:user.UID_VAL});await q('DELETE FROM GMAIL_OAUTH_STATES WHERE USER_ID=:actorUid',{actorUid:user.UID_VAL});});let revoked=!c;if(c)try{const r=await fetch('https://oauth2.googleapis.com/revoke',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({token:decrypt(c.TOKEN_CIPHER)}),signal:AbortSignal.timeout(10000)});revoked=r.ok;}catch{}return {connected:false,message:revoked?'Gmail 연결을 해제했습니다.':'앱 연결을 해제했습니다. Google 계정의 연결된 앱에서도 권한을 제거해 주세요.'};}
async function send(user,row,attachment){
 const c=await connection(user);if(!c)v.fail(503,'먼저 본인의 Gmail을 연결해 주세요.');
 const tokens=await google('https://oauth2.googleapis.com/token',{client_id:process.env.O1BO_GOOGLE_CLIENT_ID,client_secret:process.env.O1BO_GOOGLE_CLIENT_SECRET,refresh_token:decrypt(c.TOKEN_CIPHER),grant_type:'refresh_token'});
 const composer=require('nodemailer').createTransport({streamTransport:true,buffer:true,newline:'unix',disableFileAccess:true,disableUrlAccess:true});
 const message=await composer.sendMail({from:{name:'O1BO',address:c.EMAIL},to:row.RECIPIENT,subject:row.SUBJECT,text:row.CONTENT,messageId:'<'+row.ID+'@'+c.EMAIL.split('@')[1]+'>',attachments:[{filename:'O1BO_Report.docx',content:attachment,contentType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document'}]});
 const response=await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send',{method:'POST',headers:{Authorization:'Bearer '+tokens.access_token,'Content-Type':'application/json'},body:JSON.stringify({raw:message.message.toString('base64url')}),signal:AbortSignal.timeout(20000)});
 if(!response.ok)v.fail(502,'Gmail 발송 결과를 확인하지 못했습니다.');const result=await response.json();if(!result.id)v.fail(502,'Gmail 발송 결과를 확인하지 못했습니다.');return {accepted:[row.RECIPIENT]};
}
module.exports={configured,status,begin,mountPublic,disconnect,send,encrypt,decrypt};
