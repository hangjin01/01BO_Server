// AI 출력은 실행 권한이 아니다. 허용 작업·소속·소유권을 검증하고 요청 중복 처리를 트랜잭션에 묶는다.
const express=require('express'),crypto=require('node:crypto');
const db=require('../../db'),v=require('../validation'),providers=require('./providers'),managed=require('./managed'),mail=require('../mail');
const today=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date());
const items=r=>JSON.parse(r.ITINERARY_JSON||'[]');
function publicResult(r){const {pending,accessRole,...visible}=r;return visible;}
function validTime(t){if(typeof t!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(t))v.fail(400,'일정 시간을 HH:MM으로 알려주세요.');return t;}
function createAgentRouter(deps={}){
 const router=express.Router(),plan=deps.plan||providers.plan,search=deps.search||providers.search;
 const busy=new Set();
 const admit=require('../request-security').createLimiter({max:deps.maxRequests||10});
 router.get('/agent/history',async(req,res)=>{
  const cid=req.query.conversationId?v.text(req.query.conversationId,64,'conversationId'):null;
  if(cid&&!/^[a-zA-Z0-9-]{8,64}$/.test(cid))v.fail(400,'Invalid conversation ID');
  const rows=(await db.executeQuery('SELECT REQUEST_ID,CONVERSATION_ID,MESSAGE_TEXT,RESULT_JSON,CREATED_AT FROM AGENT_REQUESTS WHERE USER_ID=:actorUid AND COMPANY_CODE=:company'+(cid?' AND CONVERSATION_ID=:cid':'')+' ORDER BY CREATED_AT DESC FETCH FIRST 100 ROWS ONLY',{actorUid:req.user.UID_VAL,company:req.user.COMPANY_CODE,...(cid?{cid}:{})})).rows.filter(r=>JSON.parse(r.RESULT_JSON).accessRole===req.user.ROLE);
  const selected=cid||rows[0]?.CONVERSATION_ID||null;
  const messages=[];
  for(const row of rows.filter(r=>r.CONVERSATION_ID===selected).slice(0,20).reverse()){
   const result=publicResult(JSON.parse(row.RESULT_JSON));
   if(Date.now()-new Date(row.CREATED_AT).getTime()>15*60000)delete result.choices;
   if(result.email){const email=(await db.executeQuery('SELECT STATUS FROM REPORT_EMAILS WHERE ID=:id AND USER_ID=:actorUid AND COMPANY_CODE=:company',{id:result.email.id,actorUid:req.user.UID_VAL,company:req.user.COMPANY_CODE})).rows[0];if(email)result.email={...result.email,status:email.STATUS};else delete result.email;}
   messages.push({requestId:row.REQUEST_ID,message:row.MESSAGE_TEXT,result});
  }
  res.json({conversationId:selected,messages});
 });
 router.get('/agent/status',async(req,res)=>res.json({ai:!!process.env.OPENAI_API_KEY,provider:managed.configured()?'openai-agents':'openai-responses',places:!!(process.env.O1BO_GEOCODER_URL&&process.env.O1BO_GEOCODER_USER_AGENT),mail:await mail.configured(req.user)}));
 router.get('/agent/reports',async(req,res)=>{
  const rows=(await db.executeQuery('SELECT ID,TRIP_ID,REPORT_DATE,CONTENT FROM AGENT_REPORTS WHERE USER_ID=:actorUid AND COMPANY_CODE=:company ORDER BY CREATED_AT DESC FETCH FIRST 20 ROWS ONLY',{actorUid:req.user.UID_VAL,company:req.user.COMPANY_CODE})).rows;
  res.json({reports:rows.map(r=>({id:r.ID,tripId:r.TRIP_ID,date:r.REPORT_DATE,content:r.CONTENT}))});
 });
 router.post('/agent/messages',async(req,res)=>{
  const user=req.user,b=req.body,requestId=v.text(b.requestId,64,'requestId'),conversationId=v.text(b.conversationId,64,'conversationId');
  if(!/^[a-zA-Z0-9-]{8,64}$/.test(requestId)||!/^[a-zA-Z0-9-]{8,64}$/.test(conversationId))v.fail(400,'Invalid request ID');
  const message=v.text(b.message,4000,'message'),language=b.language==='ja'?'ja':'ko';
  const digest=v.hash(JSON.stringify({conversationId,message,choice:b.choice||null,activeTripId:b.activeTripId||null,language}));
  if(busy.has(user.UID_VAL))v.fail(409,'이전 제로보 요청을 처리 중입니다. 잠시 후 같은 요청을 다시 시도해 주세요.');
  if(!admit(user.UID_VAL))v.fail(429,'제로보 요청은 분당 10회까지 가능합니다.');
  busy.add(user.UID_VAL);
  let managedAction;
  try{
   const result=await db.transaction(async q=>{
    // Same user lock serializes across API workers. Dedupe and mutation commit together.
    const current=(await q('SELECT COMPANY_CODE,ROLE FROM USERS WHERE UID_VAL=:actorUid FOR UPDATE',{actorUid:user.UID_VAL})).rows[0];
    if(!current?.COMPANY_CODE||current.COMPANY_CODE!==user.COMPANY_CODE)v.fail(409,'회사 소속이 변경되었습니다. 다시 로그인해 주세요.');
    user.ROLE=current.ROLE;
    const existing=(await q('SELECT INPUT_HASH,RESULT_JSON,COMPANY_CODE FROM AGENT_REQUESTS WHERE USER_ID=:actorUid AND REQUEST_ID=:rid',{actorUid:user.UID_VAL,rid:requestId})).rows[0];
    if(existing){if(existing.INPUT_HASH!==digest||existing.COMPANY_CODE!==user.COMPANY_CODE)v.fail(409,'이미 사용된 요청 번호입니다.');const prior=JSON.parse(existing.RESULT_JSON);if(prior.accessRole!==user.ROLE)v.fail(409,'권한이 변경되었습니다. 새 요청으로 다시 시도해 주세요.');return publicResult(prior);}
    const history=(await q('SELECT REQUEST_ID,MESSAGE_TEXT,RESULT_JSON,CREATED_AT FROM AGENT_REQUESTS WHERE USER_ID=:actorUid AND COMPANY_CODE=:company AND CONVERSATION_ID=:cid ORDER BY CREATED_AT DESC FETCH FIRST 8 ROWS ONLY',{actorUid:user.UID_VAL,company:user.COMPANY_CODE,cid:conversationId})).rows.filter(h=>JSON.parse(h.RESULT_JSON).accessRole===user.ROLE);
    const own=(await q('SELECT * FROM TRIPS WHERE USER_ID=:actorUid AND COMPANY_CODE=:company ORDER BY START_DATE DESC FETCH FIRST 50 ROWS ONLY',{actorUid:user.UID_VAL,company:user.COMPANY_CODE})).rows;
    let action,place;
    if(b.choice){
     const last=history[0],prior=last&&JSON.parse(last.RESULT_JSON);
     if(!prior?.pending||last.REQUEST_ID!==b.choice.requestId||Date.now()-new Date(last.CREATED_AT).getTime()>15*60000||!Number.isInteger(b.choice.index)||!prior.pending.places[b.choice.index])v.fail(409,'장소 선택이 만료되었습니다. 다시 요청해 주세요.');
     action=prior.pending.action;place=prior.pending.places[b.choice.index];
    }else{
     action=await plan({today:today(),timezone:'Asia/Tokyo',language,message,activeTripId:own.some(t=>t.ID===b.activeTripId)?b.activeTripId:null,history:history.slice().reverse().map(h=>({user:h.MESSAGE_TEXT,result:publicResult(JSON.parse(h.RESULT_JSON))})),trips:own.map(t=>({id:t.ID,title:t.TITLE,startDate:t.START_DATE,endDate:t.END_DATE,itinerary:items(t).map(i=>({id:i.id,title:i.title,location:i.locationName,date:i.date,time:i.scheduledTime}))}))});
    }
    managedAction=action;
    if(!action||typeof action!=='object'||!['clarify','list_trips','create_event','update_event','write_report','send_report'].includes(action.action))v.fail(502,'지원하지 않는 AI 작업입니다. 아무 작업도 실행하지 않았습니다.');
    let result;
    if(action.action==='clarify')result={message:v.text(action.question,2000,'question'),kind:'question'};
    else if(action.action==='send_report'&&(!action.tripId||!action.date||!action.recipient))result={kind:'question',message:'메일로 보낼 본인 출장, 일보 날짜와 받는 사람 이메일 주소를 알려주세요.'};
    else if(action.action==='list_trips'){
     if(action.scope==='company'&&user.ROLE!=='admin')v.fail(403,'회사 전체 출장 현황은 사장만 조회할 수 있습니다.');
     const rows=action.scope==='company'?(await q('SELECT ID,TITLE,START_DATE,END_DATE,ITINERARY_JSON FROM TRIPS WHERE COMPANY_CODE=:company ORDER BY START_DATE DESC FETCH FIRST 50 ROWS ONLY',{company:user.COMPANY_CODE})).rows:own;
     const day=action.date?v.date(action.date):null;
     const list=rows.filter(t=>!day||(t.START_DATE<=day&&t.END_DATE>=day));
     result={kind:'answer',message:list.length?list.map(t=>`${t.TITLE} (${t.START_DATE} ~ ${t.END_DATE})\n${items(t).filter(i=>!day||i.date===day).map(i=>`  ${i.date} ${i.scheduledTime} ${i.title} · ${i.locationName}`).join('\n')}`).join('\n\n')+'\n최근 출장 최대 50건 기준입니다.':'해당 일정이 없습니다.'};
    }else{
     let trip;
     if(action.tripId)trip=(await q('SELECT * FROM TRIPS WHERE ID=:id AND USER_ID=:actorUid AND COMPANY_CODE=:company FOR UPDATE',{id:v.text(action.tripId,128,'tripId'),actorUid:user.UID_VAL,company:user.COMPANY_CODE})).rows[0];
     if((action.tripId&&!trip)||(!trip&&action.action!=='create_event'))v.fail(404,'수정할 본인 출장을 찾지 못했습니다. 출장 이름을 알려주세요.');
     if(['write_report','send_report'].includes(action.action)){
      const day=v.date(action.date);if(day<trip.START_DATE||day>trip.END_DATE)v.fail(400,'일보 날짜가 출장 기간을 벗어났습니다.');
      const savedReport=await require('./reports').saveReport(q,user,trip,day);
      // Keep previous manual report intact. Daily report is a separate saved record.
      result={kind:'report',message:'일보를 저장했습니다.\n\n'+savedReport.content,reportId:savedReport.id,tripId:trip.ID,changed:true};
      if(action.action==='send_report'){const email=await mail.draft(q,user,savedReport,action.recipient);result={...result,kind:'email_preview',email,message:'일보를 저장했습니다. 아래 수신자와 내용을 확인한 뒤 발송해 주세요. 아직 메일은 보내지 않았습니다.\n\n'+savedReport.content};}
     }else{
      const itinerary=trip?items(trip):[];
      const old=action.action==='update_event'?itinerary.find(i=>i.id===action.itemId):null;
      if(action.action==='update_event'&&!old)v.fail(404,'변경할 일정 항목을 찾지 못했습니다.');
      const day=v.date(action.date||old?.date),time=validTime(action.time||old?.scheduledTime),title=v.text(action.title||old?.title,255,'title');
      if(trip&&(day<trip.START_DATE||day>trip.END_DATE))v.fail(400,'일정 날짜가 출장 기간을 벗어났습니다. 먼저 출장 기간을 수정해 주세요.');
      if(!place&&(!old||action.location&&action.location!==old.locationName)){
       const location=v.text(action.location,255,'location');
       const choices=(await search(location)).slice(0,5).map(p=>({name:v.text(p.name,255,'place'),address:v.text(p.address,1000,'address'),coords:v.coordinate(p.coords?.latitude,p.coords?.longitude)}));
       if(!choices.length)result={kind:'question',message:'장소를 찾지 못했습니다. 도시와 상세 주소를 함께 알려주세요.'};
       else result={kind:'places',message:'방문할 장소를 선택해 주세요. 아직 일정을 저장하지 않았습니다.',choices:choices.map(p=>({name:p.name,address:p.address})),attribution:'© OpenStreetMap contributors',pending:{action:{...action,date:day,time,title},places:choices}};
      }else{
       const item={id:old?.id||crypto.randomUUID(),title,date:day,scheduledTime:time,locationName:place?.name||old.locationName,address:place?.address||old.address,coords:place?.coords||old.coords};
       if(old)itinerary.splice(itinerary.indexOf(old),1,item);else itinerary.push(item);
       itinerary.sort((a,b)=>(a.date+a.scheduledTime).localeCompare(b.date+b.scheduledTime));
       const data=v.trip({title:trip?.TITLE||title,startDate:trip?.START_DATE||day,endDate:trip?.END_DATE||day,destination:trip?.DESTINATION||item.locationName,itineraryJson:itinerary,purpose:trip?.PURPOSE||null,report:trip?.REPORT||null,status:trip?.STATUS||(day<=today()?'ongoing':'upcoming'),isSharedWithTeam:trip?.IS_SHARED_WITH_TEAM===1});
       if(trip)await q('UPDATE TRIPS SET ITINERARY_JSON=:itinerary WHERE ID=:id',{itinerary:data.itineraryJson,id:trip.ID});
       else {const id=crypto.randomUUID();await q('INSERT INTO TRIPS(ID,USER_ID,TITLE,STATUS,START_DATE,END_DATE,DESTINATION,ITINERARY_JSON,PURPOSE,REPORT,COMPANY_CODE,TEAM_CODE,IS_SHARED_WITH_TEAM) VALUES(:id,:actorUid,:title,:status,:startDate,:endDate,:destination,:itineraryJson,:purpose,:report,:company,:team,:shared)',{...data,id,actorUid:user.UID_VAL,company:user.COMPANY_CODE,team:user.TEAM_CODE||null});trip={ID:id};}
       result={kind:'success',message:`${day} ${time} ${title}\n${item.locationName}\n${old?'일정을 변경했습니다.':'일정을 등록했습니다.'}`,tripId:trip.ID,itemId:item.id,changed:true};
      }
     }
    }
    result.requestId=requestId;result.accessRole=user.ROLE;
    await q('INSERT INTO AGENT_REQUESTS(USER_ID,REQUEST_ID,COMPANY_CODE,CONVERSATION_ID,INPUT_HASH,MESSAGE_TEXT,RESULT_JSON) VALUES(:actorUid,:rid,:company,:cid,:hash,:message,:result)',{actorUid:user.UID_VAL,rid:requestId,company:user.COMPANY_CODE,cid:conversationId,hash:digest,message,result:JSON.stringify(result)});
    return publicResult(result);
   });
   await managed.finish(managedAction,result);
   res.json(result);
  }catch(error){await managed.finish(managedAction,null,error);throw error;}finally{busy.delete(user.UID_VAL);}
 });
 return router;
}
module.exports={createAgentRouter};
