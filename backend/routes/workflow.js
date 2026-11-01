const express=require('express'),crypto=require('node:crypto');
const db=require('../db'),v=require('../lib/validation'),mail=require('../lib/mail');
const {saveReport}=require('../lib/agent/reports'),{createReportDocx}=require('../lib/report-docx');
function createRouter(deps={}){
 const router=express.Router();
 router.get('/gmail/status',async(req,res)=>res.json(await require('../lib/gmail').status(req.user)));
 router.post('/gmail/connect',async(req,res)=>res.json(await require('../lib/gmail').begin(req.user)));
 router.delete('/gmail/connection',async(req,res)=>res.json(await require('../lib/gmail').disconnect(req.user)));
 const ownReport=async(user,id,q=db.executeQuery)=>{
  const row=(await q('SELECT * FROM AGENT_REPORTS WHERE ID=:id AND USER_ID=:actorUid AND COMPANY_CODE=:company',{id:v.text(id,128,'reportId'),actorUid:user.UID_VAL,company:user.COMPANY_CODE})).rows[0];
  if(!row)v.fail(404,'본인 일보를 찾지 못했습니다.');return row;
 };
 router.get('/places/search',async(req,res)=>res.json({places:await(deps.search||require('../lib/places').search)(req.query.q),attribution:'© OpenStreetMap contributors'}));
 router.get('/agent/report-options',async(req,res)=>{const rows=(await db.executeQuery('SELECT ID,TITLE,START_DATE,END_DATE FROM TRIPS WHERE USER_ID=:actorUid AND COMPANY_CODE=:company ORDER BY START_DATE DESC FETCH FIRST 50 ROWS ONLY',{actorUid:req.user.UID_VAL,company:req.user.COMPANY_CODE})).rows;res.json({trips:rows.map(r=>({id:r.ID,title:r.TITLE,startDate:r.START_DATE,endDate:r.END_DATE}))});});
 router.post('/agent/reports',async(req,res)=>{
  const user=req.user,day=v.date(req.body.date),tripId=v.text(req.body.tripId,128,'tripId'),rid=v.text(req.body.requestId,64,'requestId');
  if(!/^[a-zA-Z0-9-]{8,64}$/.test(rid))v.fail(400,'Invalid requestId');
  const digest=v.hash(JSON.stringify({type:'daily_report',day,tripId}));
  const result=await db.transaction(async q=>{
   const current=(await q('SELECT COMPANY_CODE FROM USERS WHERE UID_VAL=:actorUid FOR UPDATE',{actorUid:user.UID_VAL})).rows[0];
   if(current?.COMPANY_CODE!==user.COMPANY_CODE)v.fail(409,'회사 소속이 변경되었습니다.');
   const prior=(await q('SELECT INPUT_HASH,RESULT_JSON,COMPANY_CODE FROM AGENT_REQUESTS WHERE USER_ID=:actorUid AND REQUEST_ID=:rid',{actorUid:user.UID_VAL,rid})).rows[0];
   if(prior){if(prior.INPUT_HASH!==digest||prior.COMPANY_CODE!==user.COMPANY_CODE)v.fail(409,'이미 사용된 요청 번호입니다.');return JSON.parse(prior.RESULT_JSON);}
   const trip=(await q('SELECT * FROM TRIPS WHERE ID=:id AND USER_ID=:actorUid AND COMPANY_CODE=:company',{id:tripId,actorUid:user.UID_VAL,company:user.COMPANY_CODE})).rows[0];
   if(!trip)v.fail(404,'본인 출장을 선택해 주세요.');if(day<trip.START_DATE||day>trip.END_DATE)v.fail(400,'일보 날짜가 출장 기간을 벗어났습니다.');
   const report=await saveReport(q,user,trip,day);
   await q('INSERT INTO AGENT_REQUESTS(USER_ID,REQUEST_ID,COMPANY_CODE,CONVERSATION_ID,INPUT_HASH,MESSAGE_TEXT,RESULT_JSON) VALUES(:actorUid,:rid,:company,:cid,:hash,:message,:result)',{actorUid:user.UID_VAL,rid,company:user.COMPANY_CODE,cid:'daily-report',hash:digest,message:'일보 작성',result:JSON.stringify(report)});return report;
  });res.json(result);
 });
 router.get('/agent/reports/:id/docx',async(req,res)=>{
  const row=await ownReport(req.user,req.params.id);res.type('application/vnd.openxmlformats-officedocument.wordprocessingml.document');res.set('Content-Disposition','attachment; filename="O1BO_Report_'+row.REPORT_DATE+'.docx"');res.send(createReportDocx(row.CONTENT));
 });
 router.post('/agent/reports/:id/email-preview',async(req,res)=>{
  const report=await ownReport(req.user,req.params.id);const result=await mail.draft(db.executeQuery,req.user,{id:report.ID,content:report.CONTENT,date:report.REPORT_DATE},req.body.recipient);res.json(result);
 });
 router.get('/agent/emails',async(req,res)=>{
  const rows=(await db.executeQuery('SELECT * FROM REPORT_EMAILS WHERE USER_ID=:actorUid AND COMPANY_CODE=:company ORDER BY CREATED_AT DESC FETCH FIRST 20 ROWS ONLY',{actorUid:req.user.UID_VAL,company:req.user.COMPANY_CODE})).rows;
  res.json({emails:rows.map(mail.view)});
 });
 router.post('/agent/emails/:id/send',async(req,res)=>{
  if(req.body.confirm!==true)v.fail(400,'받는 사람과 일보를 확인한 뒤 발송해 주세요.');res.json(await mail.send(req.user,req.params.id,deps.mail));
 });
 return router;
}
module.exports={createRouter};
