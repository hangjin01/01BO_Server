const {fail}=require('./validation');
async function generate({input,instructions,format,maxOutputTokens=4000}){
 if(!process.env.OPENAI_API_KEY)fail(503,'OpenAI API 키가 아직 설정되지 않았습니다. 서버에 OPENAI_API_KEY를 설정해 주세요.');
 let response;
 try{response=await fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${process.env.OPENAI_API_KEY}`},body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4.1-mini',store:false,input,...(instructions?{instructions}:{}),...(format?{text:{format}}:{}),max_output_tokens:maxOutputTokens}),signal:AbortSignal.timeout(45000)});}catch{fail(502,'OpenAI 연결이 지연되거나 실패했습니다. 같은 요청으로 다시 시도해 주세요.');}
 if(!response.ok){if(response.status===429)fail(503,'OpenAI 사용량 또는 요청 한도를 확인해 주세요.');if([401,403].includes(response.status))fail(503,'서버 OpenAI 키의 권한과 설정을 확인해 주세요.');fail(502,'OpenAI 요청에 실패했습니다.');}
 let body;try{body=await response.json();}catch{fail(502,'OpenAI 응답을 읽지 못했습니다.');}
 if(body.status!=='completed')fail(502,'AI 응답이 완성되지 않았습니다. 작업을 실행하지 않았습니다.');
 const parts=(body.output||[]).filter(o=>o.type==='message'&&o.role==='assistant').flatMap(o=>o.content||[]);
 if(parts.some(p=>p.type==='refusal'))fail(422,'AI가 이 요청을 처리하지 못했습니다. 요청 내용을 바꿔 주세요.');
 const text=parts.filter(p=>p.type==='output_text'&&typeof p.text==='string').map(p=>p.text).join('');
 if(!text.trim())fail(502,'AI 응답이 비어 있습니다.');return text;
}
// Bridge existing OCR/report clients while keeping provider keys/model on server.
async function generateLegacy(body){
 if(!Array.isArray(body.contents)||!body.contents.length||body.contents.length>10)fail(400,'Invalid AI request');
 const input=body.contents.map(c=>{
  if(!Array.isArray(c.parts)||c.parts.length>10)fail(400,'Invalid AI content');
  return {role:'user',content:c.parts.map(p=>{
   if(typeof p.text==='string')return {type:'input_text',text:p.text};
   if(p.inlineData&&['image/jpeg','image/png','image/webp'].includes(p.inlineData.mimeType)&&typeof p.inlineData.data==='string'&&/^[A-Za-z0-9+/=]+$/.test(p.inlineData.data))return {type:'input_image',image_url:`data:${p.inlineData.mimeType};base64,${p.inlineData.data}`,detail:'auto'};
   fail(400,'Unsupported AI content');
  })};
 });
 const schema=body.generationConfig?.responseSchema;
 function convert(s,depth=0){
  if(!s||depth>10)fail(400,'Invalid output schema');
  const type=String(s.type).toLowerCase();
  if(type==='object'){
   const properties=Object.fromEntries(Object.entries(s.properties||{}).map(([k,val])=>[k,convert(val,depth+1)]));
   return {type,properties,required:Object.keys(properties),additionalProperties:false};
  }
  if(type==='array')return {type,items:convert(s.items,depth+1)};
  if(!['string','number','integer','boolean'].includes(type))fail(400,'Unsupported output schema');
  return {type};
 }
 const format=schema?{type:'json_schema',name:'app_result',strict:true,schema:{type:'object',properties:{result:convert(schema)},required:['result'],additionalProperties:false}}:undefined;
 const text=await generate({input,instructions:'Use only provided facts. Never invent coordinates, completed visits, amounts or meeting outcomes.',format,maxOutputTokens:6000});
 if(!schema)return text;
 try{const parsed=JSON.parse(text);if(!Object.hasOwn(parsed,'result'))throw new Error();return JSON.stringify(parsed.result);}catch{fail(502,'AI 응답 형식이 올바르지 않습니다.');}
}
module.exports={generate,generateLegacy};
