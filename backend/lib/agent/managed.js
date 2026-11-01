const fs=require('node:fs'),path=require('node:path');
const {fail}=require('../validation');
const {fields,schema}=require('./action-schema');
const receipts=new WeakMap();
const idFile=()=>process.env.O1BO_AGENT_ID_FILE||path.join(__dirname,'../../.private/managed-agent.json');
function configured(){return process.env.O1BO_AGENT_MODE!=='responses'&&fs.existsSync(idFile());}
function definition(){return {...require('../../config/zerobo-agent.json'),instructions:fs.readFileSync(path.join(__dirname,'../../config/zerobo-instructions.md'),'utf8'),tools:[{type:'function',name:'dispatch_zerobo',description:'Request one authorized O1BO operation or clarification. The AWS server validates permissions and returns the actual outcome.',parameters:schema}]};}
async function api(route,body,timeout=10000,method){
 if(!process.env.OPENAI_API_KEY)fail(503,'OpenAI 키가 설정되지 않았습니다.');
 let r;try{r=await fetch('https://api.openai.com/v1/agents'+route,{method:method||(body?'POST':'GET'),headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'OpenAI-Beta':'agents=v1','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(timeout)});}catch{const error=new Error('제로보 연결이 지연되었습니다. 같은 요청으로 다시 시도해 주세요.');error.status=502;error.transient=true;throw error;}
 if(!r.ok)fail(r.status===429?503:502,'OpenAI 에이전트 연결 오류 (HTTP '+r.status+').');
 if(r.status===204)return {};
 try{return await r.json();}catch{fail(502,'제로보 응답을 읽지 못했습니다.');}
}
function validate(action){
 if(!action||Array.isArray(action)||typeof action!=='object'||Object.keys(action).some(k=>!fields.includes(k))||fields.some(k=>!Object.hasOwn(action,k))||!schema.properties.action.enum.includes(action.action)||fields.some(k=>k!=='action'&&action[k]!==null&&typeof action[k]!=='string'))fail(502,'잘못된 제로보 작업입니다. 실행하지 않았습니다.');
 return action;
}
async function cancel(id){try{await api('/sessions/'+encodeURIComponent(id)+'/events',{events:[{type:'agent.session.input.cancel'}]},2000);}catch{console.warn('Managed agent cancel not acknowledged. No background tool execution is enabled.');}}
async function plan(context){
 const {id}=JSON.parse(fs.readFileSync(idFile(),'utf8'));
 if(typeof id!=='string'||!id)fail(503,'제로보 정의가 설정되지 않았습니다.');
 let session;const deadline=Date.now()+43000;
 try{
  // A fresh session per request prevents stale role/company data crossing turns.
  // Authenticated, scoped recent history is supplied by our database each time.
  const {name,...sessionDefinition}=definition();
  session=await api('/sessions',{agent_id:id,agent:sessionDefinition,environment:{type:'none'},input:JSON.stringify(context)});
  while(Date.now()<deadline){
   const calls=session.required_actions||[];
   if(calls.length){
    if(calls.length!==1||calls[0].type!=='function_call'||calls[0].name!=='dispatch_zerobo'||typeof calls[0].call_id!=='string'||typeof calls[0].turn_id!=='string')fail(502,'지원하지 않는 제로보 도구 요청입니다.');
    const action=validate(calls[0].arguments);
    receipts.set(action,{id:session.id,call:calls[0]});return action;
   }
   if(session.error||['idle','failed','cancelled','completed'].includes(session.status))fail(502,'제로보가 작업을 선택하지 못했습니다. 실행하지 않았습니다.');
   await new Promise(r=>setTimeout(r,700));
   try{session=await api('/sessions/'+encodeURIComponent(session.id),undefined,Math.max(1,Math.min(8000,deadline-Date.now())));}catch(error){if(!error.transient)throw error;} // Retry only read-only polling within the original deadline.
  }
  fail(504,'제로보 응답 시간이 초과되었습니다. 실행하지 않았습니다. 같은 요청으로 다시 시도해 주세요.');
 }catch(e){if(session?.id)await cancel(session.id);throw e;}
}
async function finish(action,result,error){
 const receipt=receipts.get(action);if(!receipt)return;receipts.delete(action);
 const {id,call}=receipt;
 try{await api('/sessions/'+encodeURIComponent(id)+'/events',{events:[{type:'agent.session.input.tool_result',turn_id:call.turn_id,call_id:call.call_id,...(error?{success:false,error:'The application rejected this operation; nothing was committed.'}:{success:true,output:JSON.stringify(result)})}]},3000);}
 catch{console.warn('Managed agent result delivery failed; the committed app result remains authoritative.');await cancel(id);}
}
module.exports={configured,definition,plan,finish,api,validate};
