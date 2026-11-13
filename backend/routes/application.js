// 클라이언트 회사 코드/역할은 신뢰하지 않는다. 조회 범위와 수정 소유권을 서버에서 각각 검사한다.
const express=require('express');const crypto=require('node:crypto');
const {executeQuery:q,transaction}=require('../db');const v=require('../lib/validation');
const router=express.Router();
const userColumns='UID_VAL,EMAIL,NAME,ROLE,COMPANY_CODE,TEAM_CODE,CREATED_AT';
function scope(user, prefix='') {return {sql:`${prefix}COMPANY_CODE=:company AND (${prefix}USER_ID=:userId OR :admin=1)`,binds:{company:user.COMPANY_CODE,userId:user.UID_VAL,admin:user.ROLE==='admin'?1:0}};}
async function getTrip(req,id,write=false,query=q,lock=false) {
  const r=await query(`SELECT * FROM TRIPS WHERE ID=:id AND COMPANY_CODE=:company AND (USER_ID=:actorUid ${write?'':"OR :admin=1"})${lock?' FOR UPDATE':''}`,{id,company:req.user.COMPANY_CODE,actorUid:req.user.UID_VAL,...(write?{}:{admin:req.user.ROLE==='admin'?1:0})});
  if(!r.rows[0])v.fail(404,'Trip not found');return r.rows[0];
}
router.get('/users',async(req,res)=>{
 const admin=req.user.ROLE==='admin';const r=await q(`SELECT ${userColumns} FROM USERS WHERE COMPANY_CODE=:company AND (:admin=1 OR UID_VAL=:actorUid)`,{company:req.user.COMPANY_CODE,admin:admin?1:0,actorUid:req.user.UID_VAL});res.json({success:true,data:r.rows});
});
router.patch('/users/me',async(req,res)=>{const name=v.text(req.body.name,100,'name');await q('UPDATE USERS SET NAME=:name WHERE UID_VAL=:actorUid',{name,actorUid:req.user.UID_VAL});res.json({success:true,data:{...req.user,NAME:name}});});
router.get('/users/:actorUid',async(req,res)=>{if(req.params.actorUid!==req.user.UID_VAL&&req.user.ROLE!=='admin')v.fail(404,'User not found');const r=await q(`SELECT ${userColumns} FROM USERS WHERE UID_VAL=:id AND COMPANY_CODE=:company`,{id:req.params.actorUid,company:req.user.COMPANY_CODE});if(!r.rows[0])v.fail(404,'User not found');res.json({success:true,data:r.rows[0]});});
router.post('/users',(req,res)=>v.fail(403,'계정과 역할은 관리자가 별도로 등록해야 합니다.'));
router.get('/companies',async(req,res)=>res.json({success:true,data:(await q('SELECT * FROM COMPANIES WHERE COMPANY_CODE=:company',{company:req.user.COMPANY_CODE})).rows}));
// Lock the account so concurrent create/join requests cannot assign two companies.
router.post('/companies',async(req,res)=>{
 const companyName=v.text(req.body?.companyName,100,'companyName');
 const ownerName=v.text(req.body?.ownerName,100,'ownerName');
 const result=await transaction(async query=>{
  const current=(await query('SELECT UID_VAL,COMPANY_CODE FROM USERS WHERE UID_VAL=:actorUid FOR UPDATE',{actorUid:req.user.UID_VAL})).rows[0];
  if(!current)v.fail(401,'로그인이 필요합니다.');
  if(current.COMPANY_CODE)v.fail(409,'이미 회사에 소속되어 있습니다. 새 회사를 만들 수 없습니다.');
  const companyCode='CO_'+crypto.randomBytes(12).toString('hex').toUpperCase();
  await query("INSERT INTO COMPANIES(COMPANY_CODE,COMPANY_NAME,STATUS) VALUES(:code,:name,'active')",{code:companyCode,name:companyName});
  await query("UPDATE USERS SET COMPANY_CODE=:company,NAME=:name,ROLE='admin',TEAM_CODE=NULL WHERE UID_VAL=:actorUid",{company:companyCode,name:ownerName,actorUid:req.user.UID_VAL});
  return {data:{...req.user,NAME:ownerName,COMPANY_CODE:companyCode,ROLE:'admin',TEAM_CODE:null},company:{COMPANY_CODE:companyCode,COMPANY_NAME:companyName}};
 });
 res.status(201).json({success:true,...result});
});
function inviteAdmin(req) {
 if(req.user.ROLE!=='admin'||!req.user.COMPANY_CODE||req.params.code!==req.user.COMPANY_CODE)v.fail(403,'Administrator required');
}
function inviteCode(body) {
 const code=v.text(body?.code,100,'invite');
 if(!/^[-A-Za-z0-9_]{43}$/.test(code))v.fail(400,'유효한 회사 초대 코드가 필요합니다.');
 return code;
}
router.get('/companies/:code/invites',async(req,res)=>{
 inviteAdmin(req);
 const rows=(await q('SELECT TOKEN_HASH,EXPIRES_AT FROM COMPANY_INVITES WHERE COMPANY_CODE=:company AND EXPIRES_AT>:now ORDER BY EXPIRES_AT DESC',{company:req.user.COMPANY_CODE,now:Date.now()})).rows;
 res.json({success:true,data:rows.map(row=>({id:row.TOKEN_HASH,expiresAt:row.EXPIRES_AT}))});
});
router.post('/companies/:code/invites',async(req,res)=>{
 inviteAdmin(req);
 const code=crypto.randomBytes(32).toString('base64url'),expiresAt=Date.now()+86400000;
 await q('INSERT INTO COMPANY_INVITES(TOKEN_HASH,COMPANY_CODE,EXPIRES_AT) VALUES(:hash,:company,:expires)',{hash:v.hash(code),company:req.user.COMPANY_CODE,expires:expiresAt});
 res.status(201).json({success:true,code,expiresAt});
});
router.delete('/companies/:code/invites/:id',async(req,res)=>{
 inviteAdmin(req);
 if(!/^[a-f0-9]{64}$/.test(req.params.id))v.fail(400,'Invalid invite');
 await q('DELETE FROM COMPANY_INVITES WHERE TOKEN_HASH=:hash AND COMPANY_CODE=:company',{hash:req.params.id,company:req.user.COMPANY_CODE});
 res.status(204).end();
});
router.post('/companies/invites/preview',async(req,res)=>{
 const code=inviteCode(req.body);
 const row=(await q("SELECT C.COMPANY_CODE,C.COMPANY_NAME FROM COMPANY_INVITES I JOIN COMPANIES C ON C.COMPANY_CODE=I.COMPANY_CODE WHERE I.TOKEN_HASH=:hash AND I.EXPIRES_AT>:now AND C.STATUS='active'",{hash:v.hash(code),now:Date.now()})).rows[0];
 if(!row)v.fail(400,'초대 코드가 만료되었거나 취소되었습니다.');
 res.json({success:true,data:row});
});
router.post('/companies/join',async(req,res)=>{
 const code=inviteCode(req.body);
 const user=await transaction(async query=>{
  const current=(await query('SELECT UID_VAL,COMPANY_CODE,TEAM_CODE,ROLE FROM USERS WHERE UID_VAL=:actorUid FOR UPDATE',{actorUid:req.user.UID_VAL})).rows[0];
  if(!current)v.fail(401,'로그인이 필요합니다.');
  const invite=(await query('SELECT COMPANY_CODE,EXPIRES_AT FROM COMPANY_INVITES WHERE TOKEN_HASH=:hash FOR UPDATE',{hash:v.hash(code)})).rows[0];
  if(!invite||invite.EXPIRES_AT<=Date.now())v.fail(400,'유효한 회사 초대 코드가 필요합니다.');
  const company=(await query("SELECT COMPANY_CODE FROM COMPANIES WHERE COMPANY_CODE=:company AND STATUS='active'",{company:invite.COMPANY_CODE})).rows[0];
  if(!company)v.fail(400,'참여할 수 없는 회사입니다.');
  if(current.COMPANY_CODE===invite.COMPANY_CODE)v.fail(409,'이미 참여 중인 회사입니다.');
  if(current.COMPANY_CODE)v.fail(409,'회사 변경은 관리자에게 요청해 주세요. 기존 기록은 원래 회사에 유지됩니다.');
  await query("UPDATE USERS SET COMPANY_CODE=:company,TEAM_CODE=NULL,ROLE='employee' WHERE UID_VAL=:actorUid",{company:invite.COMPANY_CODE,actorUid:req.user.UID_VAL});
  await query('DELETE FROM COMPANY_INVITES WHERE TOKEN_HASH=:hash',{hash:v.hash(code)});
  return {...req.user,COMPANY_CODE:invite.COMPANY_CODE,TEAM_CODE:null,ROLE:'employee'};
 });res.json({success:true,data:user});
});
router.post('/teams',async(req,res)=>{
 if(!['admin','manager'].includes(req.user.ROLE))v.fail(403,'팀 생성은 관리자 또는 매니저만 가능합니다.');
 const code='TEAM-'+crypto.randomBytes(20).toString('hex').toUpperCase();
 await transaction(async query=>{await query('INSERT INTO APP_TEAMS(TEAM_CODE,COMPANY_CODE,CREATED_BY) VALUES(:code,:company,:actorUid)',{code,company:req.user.COMPANY_CODE,actorUid:req.user.UID_VAL});await query('UPDATE USERS SET TEAM_CODE=:code WHERE UID_VAL=:actorUid',{code,actorUid:req.user.UID_VAL});});res.status(201).json({success:true,data:{...req.user,TEAM_CODE:code}});
});
router.post('/teams/join',async(req,res)=>{const code=v.text(req.body.code,50,'team code');const team=(await q('SELECT TEAM_CODE FROM APP_TEAMS WHERE TEAM_CODE=:code AND COMPANY_CODE=:company',{code,company:req.user.COMPANY_CODE})).rows[0];if(!team)v.fail(404,'같은 회사의 유효한 팀 코드가 필요합니다.');await q('UPDATE USERS SET TEAM_CODE=:code WHERE UID_VAL=:actorUid',{code,actorUid:req.user.UID_VAL});res.json({success:true,data:{...req.user,TEAM_CODE:code}});});
router.get('/trips',async(req,res)=>{
 const binds={company:req.user.COMPANY_CODE,actorUid:req.user.UID_VAL,admin:req.user.ROLE==='admin'?1:0};
 let sql='SELECT * FROM TRIPS WHERE COMPANY_CODE=:company AND (USER_ID=:actorUid OR :admin=1)';
 if(req.query.userId){sql+=' AND USER_ID=:filterUser';binds.filterUser=v.text(req.query.userId,128,'userId');}
 if(req.query.companyCode&&req.query.companyCode!==req.user.COMPANY_CODE)return res.json({success:true,data:[]});
 if(req.query.status){sql+=' AND STATUS=:status';binds.status=v.text(req.query.status,20,'status');}
 const r=await q(sql+' ORDER BY START_DATE DESC, CREATED_AT DESC',binds);res.json({success:true,data:r.rows});
});
router.get('/trips/:id',async(req,res)=>res.json({success:true,data:await getTrip(req,req.params.id)}));
router.post('/trips',async(req,res)=>{
 const b=v.trip(req.body);const id=v.text(req.body.id||crypto.randomUUID(),128,'id');
 await q(`INSERT INTO TRIPS(ID,USER_ID,TITLE,STATUS,START_DATE,END_DATE,DESTINATION,ITINERARY_JSON,PURPOSE,REPORT,COMPANY_CODE,TEAM_CODE,IS_SHARED_WITH_TEAM) VALUES(:id,:actorUid,:title,:status,:startDate,:endDate,:destination,:itineraryJson,:purpose,:report,:company,:team,:shared)`,{...b,id,actorUid:req.user.UID_VAL,company:req.user.COMPANY_CODE,team:req.user.TEAM_CODE||null});res.status(201).json({success:true,data:await getTrip(req,id,true)});
});
router.put('/trips/:id',async(req,res)=>{
 const b=v.trip(req.body);const row=await transaction(async query=>{await getTrip(req,req.params.id,true,query,true);await query('UPDATE TRIPS SET TITLE=:title,STATUS=:status,START_DATE=:startDate,END_DATE=:endDate,DESTINATION=:destination,ITINERARY_JSON=:itineraryJson,PURPOSE=:purpose,REPORT=:report,IS_SHARED_WITH_TEAM=:shared WHERE ID=:id',{...b,id:req.params.id});return getTrip(req,req.params.id,true,query);});res.json({success:true,data:row});
});
router.delete('/trips/:id',async(req,res)=>{await transaction(async query=>{await getTrip(req,req.params.id,true,query,true);await query('DELETE FROM TRIPS WHERE ID=:id',{id:req.params.id});});res.status(204).end();});
router.get('/trips/:id/summary',async(req,res)=>{
 const trip=await getTrip(req,req.params.id);if(trip.USER_ID!==req.user.UID_VAL&&req.user.ROLE!=='admin')v.fail(403,'개인 경비 조회 권한이 없습니다.');
 const expenses=(await q('SELECT AMOUNT,CATEGORY FROM EXPENSES WHERE TRIP_ID=:id AND COMPANY_CODE=:company',{id:trip.ID,company:req.user.COMPANY_CODE})).rows;
 const count=(await q("SELECT COUNT(*) CNT FROM CHECK_INS WHERE TRIP_ID=:id AND TYPE_VAL='check-in' AND COMPANY_CODE=:company",{id:trip.ID,company:req.user.COMPANY_CODE})).rows[0].CNT;
 const total=expenses.reduce((n,e)=>n+e.AMOUNT,0),byCategory={};for(const e of expenses)byCategory[e.CATEGORY]=(byCategory[e.CATEGORY]||0)+e.AMOUNT;
 const rate=Number(process.env.JPY_KRW_RATE||9.15);res.json({success:true,trip,summary:{totalExpenseJpy:total,totalExpenseKrw:Math.round(total*rate),exchangeRate:rate,rateSource:'configured',checkInCount:count,byCategory}});
});
for(const [path,table,order] of [['check-ins','CHECK_INS','TS_MILLIS'],['expenses','EXPENSES','EXPENSE_DATE']])router.get('/'+path,async(req,res)=>{
 const sc=scope(req.user);let sql=`SELECT * FROM ${table} WHERE ${sc.sql}`;const binds=sc.binds;
 if(req.query.companyCode&&req.query.companyCode!==req.user.COMPANY_CODE)return res.json({success:true,data:[]});
 for(const [param,column] of [['tripId','TRIP_ID'],['userId','USER_ID'],...(table==='EXPENSES'?[['category','CATEGORY']]:[])])if(req.query[param]){sql+=` AND ${column}=:filter_${param}`;binds['filter_'+param]=v.text(req.query[param],128,param);}
 const rows=(await q(sql+` ORDER BY ${order} DESC`,binds)).rows;
 if(table==='EXPENSES')for(const row of rows)if(row.USER_ID!==req.user.UID_VAL)row.IMAGE_URL=null;
 res.json({success:true,data:rows});
});
router.post('/expenses',async(req,res)=>{
 const b=req.body;const amount=b.amount;
 if(typeof amount!=='number'||!Number.isSafeInteger(amount)||amount<0||amount>9999999999)v.fail(400,'Invalid JPY amount');
 const id=v.text(b.id||crypto.randomUUID(),128,'id');
 const row=await transaction(async query=>{const trip=await getTrip(req,v.text(b.tripId,128,'tripId'),true,query,true);
 await query('INSERT INTO EXPENSES(ID,USER_ID,TRIP_ID,EXPENSE_DATE,MERCHANT,AMOUNT,CATEGORY,IMAGE_URL,COMPANY_CODE) VALUES(:id,:actorUid,:trip,:day,:merchant,:amount,:category,NULL,:company)',{id,actorUid:req.user.UID_VAL,trip:trip.ID,day:v.date(b.expenseDate),merchant:v.text(b.merchant,255,'merchant'),amount,category:v.text(b.category||'Other',50,'category'),company:req.user.COMPANY_CODE});return (await query('SELECT * FROM EXPENSES WHERE ID=:id',{id})).rows[0];});res.status(201).json({success:true,data:row});
});
router.delete('/expenses/:id',async(req,res)=>{const r=await q('DELETE FROM EXPENSES WHERE ID=:id AND USER_ID=:actorUid AND COMPANY_CODE=:company',{id:req.params.id,actorUid:req.user.UID_VAL,company:req.user.COMPANY_CODE});if(!r.rowsAffected)v.fail(404,'Expense not found');res.status(204).end();});
router.post('/check-ins',async(req,res)=>{
 const b=req.body;const coords=v.coordinate(b.lat,b.lng);if(!['check-in','check-out'].includes(b.typeVal))v.fail(400,'Invalid check-in type');
 const id=v.text(b.id||crypto.randomUUID(),128,'id');
 const row=await transaction(async query=>{
  const trip=await getTrip(req,v.text(b.tripId,128,'tripId'),true,query,true);
  let itinerary;try{itinerary=JSON.parse(trip.ITINERARY_JSON||'[]');}catch{v.fail(409,'일정 데이터 확인이 필요합니다.');}
  const item=itinerary.find(i=>i.id===b.itineraryItemId);if(!item)v.fail(400,'일정 항목이 필요합니다.');
  const near=v.distance(coords,v.coordinate(item.coords?.latitude,item.coords?.longitude))<=50;
  const previous=(await query('SELECT TYPE_VAL FROM CHECK_INS WHERE TRIP_ID=:trip AND ITINERARY_ITEM_ID=:item AND USER_ID=:actorUid ORDER BY TS_MILLIS DESC',{trip:trip.ID,item:item.id,actorUid:req.user.UID_VAL})).rows[0];
  if((b.typeVal==='check-in'&&previous)||(b.typeVal==='check-out'&&previous?.TYPE_VAL!=='check-in'))v.fail(409,'이미 처리되었거나 체크인 순서가 올바르지 않습니다.');
  const {verified,method,tag}=await require('../lib/nfc').verify(query,req.user,trip,item,b,near);
  await query('INSERT INTO CHECK_INS(ID,USER_ID,TRIP_ID,TS_MILLIS,LOCATION_NAME,LAT,LNG,TYPE_VAL,VERIFIED,ITINERARY_ITEM_ID,COMPANY_CODE,NFC_TAG_ID,VERIFICATION_METHOD) VALUES(:id,:actorUid,:trip,:ts,:location,:lat,:lng,:type,:verified,:item,:company,:tag,:method)',{id,actorUid:req.user.UID_VAL,trip:trip.ID,ts:Date.now(),location:v.text(item.locationName,255,'location'),lat:coords.latitude,lng:coords.longitude,type:b.typeVal,verified,item:item.id,company:req.user.COMPANY_CODE,tag,method});return (await query('SELECT * FROM CHECK_INS WHERE ID=:id',{id})).rows[0];
 });res.status(201).json({success:true,data:row});
});
router.post('/trips/:id/report/email',async(req,res)=>{
 const mail=require('../lib/mail');if(!await mail.configured(req.user))v.fail(503,'Google 계정으로 Gmail을 연결해 주세요.');
 const trip=await getTrip(req,req.params.id,true),content=v.text(req.body.report,500000,'report'),recipient=mail.address(req.body.recipient),rid=v.text(req.body.requestId,64,'requestId');
 if(!/^[a-zA-Z0-9-]{8,64}$/.test(rid))v.fail(400,'Invalid requestId');
 const digest=v.hash(JSON.stringify({trip:trip.ID,content,recipient}));
 const draft=await transaction(async query=>{
  const current=(await query('SELECT COMPANY_CODE FROM USERS WHERE UID_VAL=:actorUid FOR UPDATE',{actorUid:req.user.UID_VAL})).rows[0];if(current?.COMPANY_CODE!==req.user.COMPANY_CODE)v.fail(409,'회사 소속이 변경되었습니다.');
  const prior=(await query('SELECT INPUT_HASH,RESULT_JSON FROM AGENT_REQUESTS WHERE USER_ID=:actorUid AND REQUEST_ID=:rid',{actorUid:req.user.UID_VAL,rid})).rows[0];
  if(prior){if(prior.INPUT_HASH!==digest)v.fail(409,'이미 사용된 요청 번호입니다.');return JSON.parse(prior.RESULT_JSON);}
  const id=crypto.randomUUID();await query('INSERT INTO AGENT_REPORTS(ID,TRIP_ID,USER_ID,COMPANY_CODE,REPORT_DATE,CONTENT) VALUES(:id,:trip,:actorUid,:company,:day,:content)',{id,trip:trip.ID,actorUid:req.user.UID_VAL,company:req.user.COMPANY_CODE,day:trip.START_DATE,content});
  const email=await mail.draft(query,req.user,{id,content,date:trip.START_DATE},recipient);
  await query('INSERT INTO AGENT_REQUESTS(USER_ID,REQUEST_ID,COMPANY_CODE,CONVERSATION_ID,INPUT_HASH,MESSAGE_TEXT,RESULT_JSON) VALUES(:actorUid,:rid,:company,:cid,:hash,:message,:result)',{actorUid:req.user.UID_VAL,rid,company:req.user.COMPANY_CODE,cid:'manual-email',hash:digest,message:'보고서 이메일 발송',result:JSON.stringify(email)});return email;
 });res.json({success:true,...await mail.send(req.user,draft.id)});
});
module.exports=router;
