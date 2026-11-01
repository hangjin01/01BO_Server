const express=require('express'),crypto=require('node:crypto');
const {executeQuery:q,transaction}=require('../db'),v=require('../lib/validation'),nfc=require('../lib/nfc');
const router=express.Router();
function admin(req){if(req.user.ROLE!=='admin')v.fail(403,'회사 사장만 변경할 수 있습니다.');}
async function target(req,body,query=q){
 const tripId=v.text(body.tripId,128,'tripId'),itemId=v.text(body.itemId,128,'itemId');
 const trip=(await query('SELECT * FROM TRIPS WHERE ID=:id AND COMPANY_CODE=:company AND (USER_ID=:actorUid OR :admin=1)',{id:tripId,company:req.user.COMPANY_CODE,actorUid:req.user.UID_VAL,admin:req.user.ROLE==='admin'?1:0})).rows[0];
 if(!trip)v.fail(404,'출장을 찾을 수 없습니다.');
 const item=JSON.parse(trip.ITINERARY_JSON||'[]').find(i=>i.id===itemId);if(!item)v.fail(404,'일정을 찾을 수 없습니다.');
 return {trip,item};
}
router.get('/nfc/policy',async(req,res)=>{
 const p=await nfc.policy(q,req.user.COMPANY_CODE);
 const count=(await q('SELECT COUNT(*) CNT FROM NFC_TAGS WHERE COMPANY_CODE=:company AND ENABLED=1',{company:req.user.COMPANY_CODE})).rows[0].CNT;
 res.json({...p,tagCount:count,canManage:req.user.ROLE==='admin'});
});
router.put('/nfc/policy',async(req,res)=>{
 admin(req);if(typeof req.body.enabled!=='boolean')v.fail(400,'enabled must be boolean');
 await transaction(async query=>{
  await query('SELECT COMPANY_CODE FROM COMPANIES WHERE COMPANY_CODE=:company FOR UPDATE',{company:req.user.COMPANY_CODE});
  if(req.body.enabled){const count=(await query('SELECT COUNT(*) CNT FROM NFC_TAGS WHERE COMPANY_CODE=:company AND ENABLED=1',{company:req.user.COMPANY_CODE})).rows[0].CNT;if(!count)v.fail(409,'현장 태그를 먼저 등록해 주세요.');}
  await query('MERGE INTO COMPANY_NFC_POLICY p USING (SELECT :company COMPANY_CODE FROM DUAL) s ON (p.COMPANY_CODE=s.COMPANY_CODE) WHEN MATCHED THEN UPDATE SET NFC_REQUIRED=:enabled,UPDATED_BY=:actorUid,UPDATED_AT=SYSTIMESTAMP WHEN NOT MATCHED THEN INSERT(COMPANY_CODE,NFC_REQUIRED,UPDATED_BY) VALUES(:company,:enabled,:actorUid)',{company:req.user.COMPANY_CODE,enabled:req.body.enabled?1:0,actorUid:req.user.UID_VAL});
 });res.json({enabled:req.body.enabled});
});
router.get('/nfc/requirement',async(req,res)=>{const {trip,item}=await target(req,req.query);res.json(await nfc.requirement(q,req.user.COMPANY_CODE,trip.ID,item.id));});
router.get('/nfc/tags',async(req,res)=>{admin(req);res.json({tags:(await q('SELECT TAG_HASH,TRIP_ID,ITEM_ID,ENABLED FROM NFC_TAGS WHERE COMPANY_CODE=:company',{company:req.user.COMPANY_CODE})).rows});});
router.post('/nfc/tags',async(req,res)=>{
 admin(req);const tag=v.text(req.body.tagId,128,'tagId');if(!/^o1bo:[a-f0-9]{64}$/.test(tag))v.fail(400,'앱에서 발급한 현장 태그가 필요합니다.');
 await transaction(async query=>{const {trip,item}=await target(req,req.body,query);
  await query('SELECT COMPANY_CODE FROM COMPANIES WHERE COMPANY_CODE=:company FOR UPDATE',{company:req.user.COMPANY_CODE});
  await query('INSERT INTO NFC_TAGS(TAG_HASH,COMPANY_CODE,TRIP_ID,ITEM_ID,ENABLED) VALUES(:hash,:company,:trip,:item,1)',{hash:v.hash(tag),company:req.user.COMPANY_CODE,trip:trip.ID,item:item.id});
 });res.status(201).json({success:true});
});
router.delete('/nfc/tags/:id',async(req,res)=>{
 admin(req);await transaction(async query=>{
  await query('SELECT COMPANY_CODE FROM COMPANIES WHERE COMPANY_CODE=:company FOR UPDATE',{company:req.user.COMPANY_CODE});
  // Keep disabled bindings: removing a tag must not silently bypass a required site.
  if((await nfc.policy(query,req.user.COMPANY_CODE)).enabled)v.fail(409,'회사 NFC 설정을 끈 뒤 태그를 해제해 주세요.');
  await query('UPDATE NFC_TAGS SET ENABLED=0 WHERE TAG_HASH=:hash AND COMPANY_CODE=:company',{hash:v.text(req.params.id,64,'id'),company:req.user.COMPANY_CODE});
 });res.status(204).end();
});
router.post('/nfc/challenge',async(req,res)=>{
 const {trip,item}=await target(req,req.body);if(trip.USER_ID!==req.user.UID_VAL)v.fail(403,'본인 일정만 체크인할 수 있습니다.');
 if(!['check-in','check-out'].includes(req.body.typeVal))v.fail(400,'Invalid type');
 const token=crypto.randomBytes(32).toString('hex');
 await q('DELETE FROM NFC_CHALLENGES WHERE EXPIRES_AT<:now',{now:Date.now()});
 await q('INSERT INTO NFC_CHALLENGES(TOKEN_HASH,USER_ID,COMPANY_CODE,TRIP_ID,ITEM_ID,TYPE_VAL,EXPIRES_AT) VALUES(:hash,:actorUid,:company,:trip,:item,:type,:expires)',{hash:v.hash(token),actorUid:req.user.UID_VAL,company:req.user.COMPANY_CODE,trip:trip.ID,item:item.id,type:req.body.typeVal,expires:Date.now()+60000});
 res.json({token});
});
module.exports=router;
