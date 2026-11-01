const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const managed=require('../lib/agent/managed'),{fields}=require('../lib/agent/action-schema');
(async()=>{
 const originalFetch=global.fetch,originalKey=process.env.OPENAI_API_KEY,originalFile=process.env.O1BO_AGENT_ID_FILE;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zerobo-test-'));
 process.env.O1BO_AGENT_ID_FILE=path.join(dir,'id.json');process.env.OPENAI_API_KEY='test-only';
 fs.writeFileSync(process.env.O1BO_AGENT_ID_FILE,JSON.stringify({id:'agent_test'}));
 const action={...Object.fromEntries(fields.map(f=>[f,null])),action:'list_trips',scope:'own'};
 const pending={id:'session_test',status:'requires_action',required_actions:[{type:'function_call',name:'dispatch_zerobo',call_id:'call_test',turn_id:'turn_test',arguments:action}]};
 try{
  let requests=[];
  global.fetch=async(url,options)=>{requests.push({url,body:JSON.parse(options.body)});return new Response(JSON.stringify(pending));};
  const result=await managed.plan({message:'내 일정',trips:[]});assert.deepEqual(result,action);
  assert.equal(requests[0].body.environment.type,'none');assert.equal(requests[0].body.agent_id,'agent_test');assert.equal(requests[0].body.agent.name,undefined);
  assert.deepEqual(requests[0].body.agent.tools.map(t=>t.name),['dispatch_zerobo']);
  await managed.finish(result,{message:'조회 결과',kind:'answer'});
  assert.equal(requests[1].body.events[0].success,true);assert.equal(requests[1].body.events[0].call_id,'call_test');
  await managed.finish(result,{});assert.equal(requests.length,2,'receipt must only finish once');
  for(const bad of [{...action,action:'delete_all'},{...action,role:'admin'},{action:'list_trips'},{...action,date:5}])assert.throws(()=>managed.validate(bad));
  for(const response of [{...pending,required_actions:[{...pending.required_actions[0],name:'run_sql'}]},{...pending,required_actions:[...pending.required_actions,...pending.required_actions]},{...pending,status:'idle',required_actions:[]}]){
   requests=[];global.fetch=async(url,options)=>{requests.push({url,body:options.body&&JSON.parse(options.body)});return new Response(JSON.stringify(response));};
   await assert.rejects(()=>managed.plan({message:'test'}));assert.equal(requests.at(-1).body.events[0].type,'agent.session.input.cancel');
  }
  let polls=0,creates=0;
  global.fetch=async(url,options)=>{
   if(options.method==='POST'){creates++;return new Response(JSON.stringify({...pending,status:'in_progress',required_actions:[]}));}
   if(++polls===1)throw new Error('simulated transient timeout');
   return new Response(JSON.stringify(pending));
  };
  assert.deepEqual(await managed.plan({message:'test'}),action);assert.equal(creates,1);assert.equal(polls,2);
  global.fetch=async()=>new Response(null,{status:204});assert.deepEqual(await managed.api('/sessions/test/events',{events:[]}),{});
  global.fetch=async()=>new Response('secret error body',{status:401});await assert.rejects(()=>managed.plan({}),e=>!e.message.includes('secret'));
  console.log('PASS: managed session isolation, no sandbox, function allowlist/schema, duplicate receipt, rejected multi-call, idle/error and cancellation. No external API called.');
 }finally{global.fetch=originalFetch;for(const [key,value]of [['OPENAI_API_KEY',originalKey],['O1BO_AGENT_ID_FILE',originalFile]])if(value===undefined)delete process.env[key];else process.env[key]=value;fs.rmSync(dir,{recursive:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
