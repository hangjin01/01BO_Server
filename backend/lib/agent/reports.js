const crypto=require('node:crypto');
const items=r=>JSON.parse(r.ITINERARY_JSON||'[]');
async function saveReport(q,user,trip,day){
 const reportId=crypto.randomUUID();
      const records=(await q('SELECT TS_MILLIS,LOCATION_NAME,TYPE_VAL,VERIFIED FROM CHECK_INS WHERE TRIP_ID=:id AND USER_ID=:actorUid AND COMPANY_CODE=:company ORDER BY TS_MILLIS',{id:trip.ID,actorUid:user.UID_VAL,company:user.COMPANY_CODE})).rows.filter(r=>new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo'}).format(new Date(r.TS_MILLIS))===day);
      const expenses=(await q('SELECT MERCHANT,AMOUNT,CATEGORY FROM EXPENSES WHERE TRIP_ID=:id AND USER_ID=:actorUid AND COMPANY_CODE=:company AND EXPENSE_DATE=:day',{id:trip.ID,actorUid:user.UID_VAL,company:user.COMPANY_CODE,day})).rows;
      const report=`## ${day} 출장 일보 — ${trip.TITLE}\n\n### 예정 일정\n${items(trip).filter(i=>i.date===day).map(i=>`- ${i.scheduledTime} ${i.title} · ${i.locationName}`).join('\n')||'- 등록된 일정 없음'}\n\n### 실제 방문 기록\n${records.map(r=>`- ${new Intl.DateTimeFormat('ko-KR',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(r.TS_MILLIS))} ${r.LOCATION_NAME} · ${r.TYPE_VAL} · ${r.VERIFIED?'현장 인증':'미인증'}`).join('\n')||'- 기록 없음 (방문 완료 여부 확인 불가)'}\n\n### 등록 경비\n${expenses.map(e=>`- ${e.MERCHANT}: ¥${e.AMOUNT} (${e.CATEGORY})`).join('\n')||'- 등록 경비 없음'}\n- 합계: ¥${expenses.reduce((s,e)=>s+Number(e.AMOUNT),0)}\n\n※ 등록된 기록으로 작성했습니다. 회의 성과와 미등록 활동은 포함하지 않았습니다.`;
      await q('INSERT INTO AGENT_REPORTS(ID,TRIP_ID,USER_ID,COMPANY_CODE,REPORT_DATE,CONTENT) VALUES(:id,:trip,:actorUid,:company,:day,:content)',{id:reportId,trip:trip.ID,actorUid:user.UID_VAL,company:user.COMPANY_CODE,day,content:report});
 return {id:reportId,content:report,date:day,tripId:trip.ID};
}
module.exports={saveReport};
