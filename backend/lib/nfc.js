const v = require('./validation');
async function policy(query, company) {
 const row=(await query('SELECT NFC_REQUIRED FROM COMPANY_NFC_POLICY WHERE COMPANY_CODE=:company',{company})).rows[0];
 return {enabled:row?.NFC_REQUIRED===1,radiusMeters:50};
}
async function requirement(query,company,trip,item){
 const p=await policy(query,company);
 const row=(await query('SELECT COUNT(*) CNT FROM NFC_TAGS WHERE COMPANY_CODE=:company AND TRIP_ID=:trip AND ITEM_ID=:item AND ENABLED=1',{company,trip,item})).rows[0];
 return {...p,required:p.enabled&&row.CNT>0,registered:row.CNT>0};
}
async function verify(query,user,trip,item,body,near){
 const rule=await requirement(query,user.COMPANY_CODE,trip.ID,item.id);
 const tag=v.text(body.nfcTagId,128,'tag',false);
 if(rule.required&&(!tag||tag==='manual'))v.fail(422,'이 현장은 NFC 이중 확인이 필요합니다. 등록된 태그를 접촉해 주세요.');
 if(tag&&tag!=='manual'){
  const row=(await query('SELECT TAG_HASH FROM NFC_TAGS WHERE TAG_HASH=:hash AND COMPANY_CODE=:company AND TRIP_ID=:trip AND ITEM_ID=:item AND ENABLED=1',{hash:v.hash(tag),company:user.COMPANY_CODE,trip:trip.ID,item:item.id})).rows[0];
  if(!row||!near)v.fail(422,'등록된 현장 태그와 50m 이내 위치가 필요합니다.');
  if(typeof body.locationAccuracy!=='number'||body.locationAccuracy<0||body.locationAccuracy>50||!Number.isFinite(body.locationAccuracy))v.fail(422,'GPS 정확도가 부족합니다. 실외에서 위치를 다시 확인해 주세요.');
  if(typeof body.locationTimestamp!=='number'||Math.abs(Date.now()-body.locationTimestamp)>60000)v.fail(422,'현재 위치를 다시 확인해 주세요.');
  const nonce=v.text(body.nfcChallenge,128,'challenge');
  const used=await query('DELETE FROM NFC_CHALLENGES WHERE TOKEN_HASH=:hash AND USER_ID=:actorUid AND COMPANY_CODE=:company AND TRIP_ID=:trip AND ITEM_ID=:item AND TYPE_VAL=:type AND EXPIRES_AT>:now',{hash:v.hash(nonce),actorUid:user.UID_VAL,company:user.COMPANY_CODE,trip:trip.ID,item:item.id,type:body.typeVal,now:Date.now()});
  if(used.rowsAffected!==1)v.fail(409,'NFC 확인 시간이 만료되었거나 이미 사용되었습니다. 다시 접촉해 주세요.');
  return {verified:1,method:'nfc_gps',tag:v.hash(tag)};
 }
 return {verified:near?1:0,method:near?'gps':'unverified',tag:'manual'};
}
module.exports={policy,requirement,verify};
