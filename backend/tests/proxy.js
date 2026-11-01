const assert=require('node:assert/strict');
const {createApp}=require('../server');
async function check(trust){
 process.env.TRUSTED_PROXY_CIDRS=trust;
 const app=createApp();
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 try{
  const base='http://127.0.0.1:'+server.address().port;
  const request=(headers={})=>new Promise((resolve,reject)=>{const r=require('node:http').request(base+'/api/auth/login',{method:'POST',headers:{Host:'api.01bo.cloud','Content-Type':'application/json',...headers}},res=>{res.resume();res.on('end',()=>resolve({status:res.statusCode}));});r.on('error',reject);r.end('{}');});
  assert.equal((await request()).status,403);
  assert.equal((await request({'X-Forwarded-Host':'localhost'})).status,403);
  assert.equal((await request({'X-Forwarded-Proto':'https'})).status,trust?400:403);
  const allowed=await fetch(base+'/api/auth/login',{method:'OPTIONS',headers:{Origin:'https://localhost','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});
  assert.equal(allowed.status,204);assert.equal(allowed.headers.get('access-control-allow-origin'),'https://localhost');
  assert.equal((await fetch(base+'/api/auth/me',{headers:{Origin:'https://untrusted.invalid'}})).status,403);
 }finally{await new Promise(resolve=>server.close(resolve));}
}
(async()=>{await check('');await check('loopback');console.log('PASS: untrusted forwarded protocol rejected, trusted HTTPS accepted, host spoof blocked, native preflight allowed, foreign origin rejected.');})().catch(e=>{console.error(e);process.exitCode=1;});
