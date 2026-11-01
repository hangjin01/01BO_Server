const assert=require('node:assert/strict');
const {generate,generateLegacy}=require('../lib/openai');const {plan}=require('../lib/agent/providers');
(async()=>{
 const original=process.env.OPENAI_API_KEY,originalFetch=global.fetch,originalMode=process.env.O1BO_AGENT_MODE;let request;
 try{
  process.env.O1BO_AGENT_MODE='responses';
  delete process.env.OPENAI_API_KEY;await assert.rejects(()=>generate({input:'hello'}),e=>e.status===503);
  process.env.OPENAI_API_KEY='test-only-never-transmitted';
  const reply=text=>({status:'completed',output:[{type:'reasoning',summary:[]},{type:'message',role:'assistant',content:[{type:'output_text',text}]}]});
  global.fetch=async(url,options)=>{request={url,options,body:JSON.parse(options.body)};return new Response(JSON.stringify(reply(JSON.stringify({action:'clarify',question:'어느 날짜인가요?'}))));};
  assert.equal((await plan({language:'ko',message:'일정 잡아줘'})).action,'clarify');
  assert.equal(request.url,'https://api.openai.com/v1/responses');assert.equal(request.body.store,false);assert.equal(request.body.text.format.strict,true);assert.equal(request.body.text.format.schema.additionalProperties,false);assert.equal(request.body.text.format.schema.required.length,10);
  global.fetch=async(url,options)=>{request=JSON.parse(options.body);return new Response(JSON.stringify(reply('{"result":[{"title":"A"}]}')));};
  assert.equal(await generateLegacy({contents:[{parts:[{text:'JSON'},{inlineData:{mimeType:'image/jpeg',data:'YWJj'}}]}],generationConfig:{responseSchema:{type:'ARRAY',items:{type:'OBJECT',properties:{title:{type:'STRING'}}}}}}),'[{"title":"A"}]');
  assert.equal(request.input[0].content[1].type,'input_image');assert.equal(request.text.format.schema.properties.result.type,'array');
  for(const body of [{status:'incomplete',output:[]},{status:'completed',output:[{type:'message',role:'assistant',content:[{type:'refusal',refusal:'no'}]}]},{status:'completed',output:[]}]){global.fetch=async()=>new Response(JSON.stringify(body));await assert.rejects(()=>generate({input:'hello'}));}
  for(const code of [401,403,429,500]){global.fetch=async()=>new Response('secret must not leak',{status:code});await assert.rejects(()=>generate({input:'hello'}),e=>!e.message.includes('secret'));}
  global.fetch=async()=>new Response(JSON.stringify(reply('{"action":"delete_all"}')));await assert.rejects(()=>plan({}),e=>e.status===502);
  console.log('PASS: OpenAI Responses request, strict schema, image/array compatibility, missing key, refusal, incomplete/error handling, invalid tool rejection. No external API called.');
 }finally{if(originalMode===undefined)delete process.env.O1BO_AGENT_MODE;else process.env.O1BO_AGENT_MODE=originalMode;global.fetch=originalFetch;if(original===undefined)delete process.env.OPENAI_API_KEY;else process.env.OPENAI_API_KEY=original;}
})().catch(e=>{console.error(e.message);process.exit(1)});
