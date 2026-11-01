// Creates only the saved definition. Session routing/tools are a separate step.
const fs=require('node:fs');
const {definition,api}=require('../lib/agent/managed');
const config=definition();
(async()=>{
 const file=process.env.O1BO_AGENT_ID_FILE;
 if(!file)throw new Error('O1BO_AGENT_ID_FILE must point to a private persistent file.');
 if(fs.existsSync(file)){
  const saved=JSON.parse(fs.readFileSync(file,'utf8'));
  if(!process.argv.includes('--update')){console.log('Saved agent exists. Use --update to apply the definition.');return;}
  await api('/'+encodeURIComponent(saved.id),config,15000);
  console.log('Saved agent definition and tool updated.');return;
 }
 if(!process.env.OPENAI_API_KEY)throw new Error('OPENAI_API_KEY is not configured.');
 const r=await fetch('https://api.openai.com/v1/agents',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json','OpenAI-Beta':'agents=v1'},body:JSON.stringify(config),signal:AbortSignal.timeout(45000)});
 if(!r.ok)throw new Error('Agent creation failed (HTTP '+r.status+'). Check project permissions; no automatic retry.');
 const result=await r.json();
 if(typeof result.id!=='string'||!result.id)throw new Error('Missing agent ID; inspect dashboard before retrying.');
 try{fs.writeFileSync(file,JSON.stringify({id:result.id,model:config.model,createdAt:new Date().toISOString()})+'\n',{mode:0o600,flag:'wx'});}catch{console.log('Created agent ID: '+result.id);throw new Error('Persist this ID before retrying; saved agent exists.');}
 console.log('Saved agent created. Application sessions/tools are not connected yet.');
})().catch(e=>{console.error(e.message);process.exitCode=1});
