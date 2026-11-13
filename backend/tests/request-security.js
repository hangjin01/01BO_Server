const assert=require('node:assert/strict');
const {createLimiter,errorHandler}=require('../lib/request-security');
const {createApp}=require('../server');
const zlib=require('node:zlib');

async function run(){
  // Saturation must not evict active identities and reset their request quotas.
  let now=0;
  const admit=createLimiter({max:2,windowMs:100,capacity:2,clock:()=>now});
  assert.equal(admit('a'),true);assert.equal(admit('a'),true);
  assert.equal(admit('a'),false);assert.equal(admit('b'),true);
  assert.equal(admit('c'),false);assert.equal(admit('a'),false);
  now=100;assert.equal(admit('c'),true);assert.equal(admit('a'),true);

  const server=await new Promise(resolve=>{const s=createApp().listen(0,'127.0.0.1',()=>resolve(s));});
  const base='http://127.0.0.1:'+server.address().port;
  try{
    const health=await fetch(base+'/health');
    assert.equal(health.status,200);
    assert.equal(health.headers.get('x-frame-options'),'DENY');
    assert.equal(health.headers.get('referrer-policy'),'no-referrer');
    assert.equal(health.headers.get('strict-transport-security'),null);
    const denied=await fetch(base+'/api/auth/logout',{method:'POST',body:'x=1'});
    assert.equal(denied.status,415,'simple form requests must not mutate cookie sessions');
    const bad=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"password":"never-echo-this"'});
    assert.equal(bad.status,400);assert.ok(!(await bad.text()).includes('never-echo-this'));
    const compressed=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json','Content-Encoding':'gzip'},body:zlib.gzipSync('{}')});
    assert.equal(compressed.status,415);
    const blocked=await fetch(base+'/api/auth/logout',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://attacker.invalid'},body:'{}'});
    assert.equal(blocked.status,403);
    let status,body;
    errorHandler({errorNum:2292,message:'INTERNAL_SCHEMA.TABLE'}, {}, {status(n){status=n;return this;},json(x){body=x;}},()=>{});
    assert.equal(status,409);assert.ok(!body.message.includes('INTERNAL_SCHEMA'));
    console.log('PASS: bounded quotas, JSON-only writes, parser redaction, compression rejection, security headers and Origin rejection. No external API or DB used.');
  }finally{await new Promise(resolve=>server.close(resolve));}
}
run().catch(error=>{console.error(error);process.exitCode=1;});
