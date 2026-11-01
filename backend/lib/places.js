const db=require('../db'),v=require('./validation');
const cache=new Map();
async function search(input){
 const query=v.text(input,255,'검색어');
 if(!process.env.O1BO_GEOCODER_URL||!process.env.O1BO_GEOCODER_USER_AGENT)v.fail(503,'장소 검색 서비스 연결이 필요합니다.');
 const url=new URL(process.env.O1BO_GEOCODER_URL);if(url.protocol!=='https:')v.fail(503,'장소 검색에는 HTTPS가 필요합니다.');
 const key=url.href+'|'+query.normalize('NFKC'),cached=cache.get(key);
 if(cached&&cached.expires>Date.now())return structuredClone(cached.rows);
 const now=Date.now();
 // One database gate covers manual search and agent calls across API workers.
 const claim=await db.executeQuery("UPDATE APP_SERVICE_LIMITS SET NEXT_AT=:nextAt WHERE NAME_VAL='geocoder' AND NEXT_AT<=:nowAt",{nextAt:now+1200,nowAt:now});
 if(claim.rowsAffected!==1)v.fail(429,'장소 검색 중입니다. 잠시 후 검색 버튼을 다시 눌러 주세요.');
 url.searchParams.set('q',query);url.searchParams.set('format','jsonv2');url.searchParams.set('limit','5');url.searchParams.set('countrycodes','kr,jp');
 let response;try{response=await fetch(url,{headers:{'User-Agent':process.env.O1BO_GEOCODER_USER_AGENT,'Accept-Language':'ko,ja;q=0.9,en;q=0.8'},signal:AbortSignal.timeout(10000)});}catch{v.fail(502,'장소 검색 연결이 지연되었습니다.');}
 if(!response.ok)v.fail(502,'장소 검색에 실패했습니다. 잠시 후 다시 검색해 주세요.');
 let data;try{data=await response.json();}catch{v.fail(502,'장소 검색 응답을 읽지 못했습니다.');}
 if(!Array.isArray(data))v.fail(502,'잘못된 장소 검색 응답입니다.');
 const rows=data.slice(0,5).map(r=>({name:v.text(r.name||query,255,'place'),address:v.text(r.display_name,1000,'address'),coords:v.coordinate(r.lat,r.lon)}));
 if(cache.size>=500)cache.delete(cache.keys().next().value);
 cache.set(key,{expires:now+86400000,rows});return structuredClone(rows);
}
module.exports={search};
