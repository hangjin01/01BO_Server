const crypto=require('node:crypto');
const db=require('../db'),v=require('./validation');
const {createReportDocx}=require('./report-docx');
function address(value){const email=v.text(value,254,'recipient');if(!/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?\.[A-Za-z]{2,}$/.test(email))v.fail(400,'받는 사람 이메일 주소를 확인해 주세요.');return email;}
async function configured(user){return user?(await require('./gmail').status(user)).connected:require('./gmail').configured();}
function view(row){return {id:row.ID,recipient:row.RECIPIENT,subject:row.SUBJECT,content:row.CONTENT,status:row.STATUS,reportId:row.REPORT_ID,filename:'O1BO_Report.docx'};}
async function draft(q,user,report,recipient){
 const row={ID:crypto.randomUUID(),REPORT_ID:report.id,RECIPIENT:address(recipient),SUBJECT:'O1BO 출장 일보 '+report.date,CONTENT:report.content,STATUS:'draft'};
 await q('INSERT INTO REPORT_EMAILS(ID,REPORT_ID,USER_ID,COMPANY_CODE,RECIPIENT,SUBJECT,CONTENT,STATUS) VALUES(:id,:reportId,:actorUid,:company,:recipient,:subject,:content,:status)',{id:row.ID,reportId:row.REPORT_ID,actorUid:user.UID_VAL,company:user.COMPANY_CODE,recipient:row.RECIPIENT,subject:row.SUBJECT,content:row.CONTENT,status:row.STATUS});
 return view(row);
}
async function send(user,id,deps={}){
 if(!await(deps.configured||configured)(user))v.fail(503,'먼저 Google 계정으로 Gmail을 연결해 주세요. 메일은 보내지 않았습니다.');
 const row=await db.transaction(async q=>{
  const current=(await q('SELECT COMPANY_CODE FROM USERS WHERE UID_VAL=:actorUid FOR UPDATE',{actorUid:user.UID_VAL})).rows[0];
  if(current?.COMPANY_CODE!==user.COMPANY_CODE)v.fail(409,'회사 소속이 변경되었습니다.');
  const r=(await q('SELECT * FROM REPORT_EMAILS WHERE ID=:id AND USER_ID=:actorUid AND COMPANY_CODE=:company FOR UPDATE',{id:v.text(id,128,'emailId'),actorUid:user.UID_VAL,company:user.COMPANY_CODE})).rows[0];
  if(!r)v.fail(404,'발송할 본인 일보를 찾지 못했습니다.');
  if(r.STATUS==='sent')return r;
  if(r.STATUS!=='draft')v.fail(409,'발송 중이거나 결과 확인이 필요한 요청입니다. Gmail 보낸편지함을 확인해 주세요. 자동 재발송하지 않습니다.');
  const recent=(await q("SELECT COUNT(*) CNT FROM REPORT_EMAILS WHERE USER_ID=:actorUid AND STATUS<>'draft' AND UPDATED_AT>SYSTIMESTAMP-INTERVAL '1' HOUR",{actorUid:user.UID_VAL})).rows[0].CNT;
  if(recent>=10)v.fail(429,'이메일 발송은 시간당 10회까지 가능합니다.');
  await q("UPDATE REPORT_EMAILS SET STATUS='sending',UPDATED_AT=SYSTIMESTAMP WHERE ID=:id",{id:r.ID});return r;
 });
 if(row.STATUS==='sent')return {id:row.ID,status:'sent',message:'이미 메일 서버가 접수한 요청입니다. 중복 발송하지 않았습니다.'};
 let info;
 try{info=await(deps.smtp||((r)=>require('./gmail').send(user,r,createReportDocx(r.CONTENT))))(row);if(!info.accepted?.length)throw new Error('not accepted');}
 catch{await db.executeQuery("UPDATE REPORT_EMAILS SET STATUS='unknown',UPDATED_AT=SYSTIMESTAMP WHERE ID=:id",{id:row.ID});v.fail(502,'발송 결과를 확인하지 못했습니다. Gmail 보낸편지함을 확인해 주세요. 중복 방지를 위해 자동 재발송하지 않습니다.');}
 // If this update fails, durable 'sending' prevents another SMTP attempt.
 await db.executeQuery("UPDATE REPORT_EMAILS SET STATUS='sent',UPDATED_AT=SYSTIMESTAMP WHERE ID=:id",{id:row.ID});
 return {id:row.ID,status:'sent',message:'메일 서버가 Word 일보가 첨부된 이메일을 접수했습니다. 수신함 도착 여부는 별도로 확인해 주세요.'};
}
module.exports={configured,address,draft,send,view};
