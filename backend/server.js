const express=require('express');const cors=require('cors');
const db=require('./db');const auth=require('./lib/auth');const {fail}=require('./lib/validation');
function createApp(options={}){
 const app=express();app.disable('x-powered-by');
 const trustedProxies=(process.env.TRUSTED_PROXY_CIDRS||'').split(',').map(s=>s.trim()).filter(Boolean);
 if(trustedProxies.length)app.set('trust proxy',trustedProxies);
 // ALB supplies protocol/client IP; never accept a client-provided host override.
 app.use((req,res,next)=>{delete req.headers['x-forwarded-host'];next();});
 // ALB liveness probe: independent of database queries and authentication.
 app.get('/health',(req,res)=>res.set('Cache-Control','no-store').status(200).json({success:true,message:'OK'}));
 const origins=(process.env.ALLOWED_ORIGINS||'http://localhost:5173,http://127.0.0.1:5173,https://localhost,capacitor://localhost').split(',').map(s=>s.trim());
 app.use((req,res,next)=>{res.set('Cache-Control','no-store');res.set('X-Content-Type-Options','nosniff');if(req.headers.origin&&!origins.includes(req.headers.origin))return res.status(403).json({success:false,message:'Origin not allowed'});if(!['GET','HEAD','OPTIONS'].includes(req.method)&&req.headers['content-type']&&req.headers['content-type'].split(';')[0].trim().toLowerCase()!=='application/json')return res.status(415).json({success:false,message:'JSON required'});next();});
 app.use(cors({origin:origins,credentials:true}));app.use(express.json({limit:'15mb'}));
 app.get('/api/health',async(req,res)=>{try{await db.executeQuery('SELECT 1 OK FROM DUAL');res.json({status:'OK',database:'ready',version:'2026-10-02-workflow',timestamp:new Date().toISOString()});}catch{res.status(503).json({status:'UNAVAILABLE',database:'unavailable'});}});
 const limits=new Map();
 app.use('/api',(req,res,next)=>{const key=req.ip;const now=Date.now();if(limits.size>10000)for(const [k,v]of limits)if(v.until<now)limits.delete(k);let hit=limits.get(key);if(!hit||hit.until<now){hit={count:0,until:now+60000};limits.set(key,hit);}if(++hit.count>180)return res.status(429).json({success:false,message:'요청이 너무 많습니다.'});next();});
 require('./lib/gmail').mountPublic(app);
 app.use('/api',auth.session);const ar=express.Router();auth.routes(ar);app.use('/api/auth',ar);app.use('/api',auth.required);
 // A signed-in account without a company can only complete membership/profile setup.
 app.use('/api',(req,res,next)=>{
  if(!req.user.COMPANY_CODE && ![
   'GET /companies','POST /companies','PATCH /users/me','POST /companies/invites/preview','POST /companies/join'
  ].includes(req.method+' '+req.path))fail(403,'회사를 만들거나 초대 코드로 먼저 참여해 주세요.');
  next();
 });
 app.get('/api/exchange-rate',(req,res)=>{const jpy=Number(req.query.jpy||0),rate=Number(process.env.JPY_KRW_RATE||9.15);if(!Number.isFinite(jpy)||jpy<0)fail(400,'Invalid amount');res.json({jpy,rate,krw:Math.round(jpy*rate),source:'configured'});});
 const aiLimits=new Map();
 app.post('/api/ai/generate',async(req,res)=>{

  const now=Date.now(),entry=aiLimits.get(req.user.UID_VAL)||{count:0,until:now+60000};if(entry.until<now){entry.count=0;entry.until=now+60000;}if(++entry.count>10)fail(429,'AI 요청은 분당 10회까지 가능합니다.');aiLimits.set(req.user.UID_VAL,entry);
  res.json({text:await require('./lib/openai').generateLegacy(req.body)});
 });
 app.use('/api',require('./lib/agent').createAgentRouter(options.agent));
 app.use('/api',require('./routes/workflow').createRouter(options.workflow));
 app.use('/api',require('./routes/nfc'));
 app.use('/api',require('./routes/application'));
 app.use((req,res)=>res.status(404).json({success:false,message:'Endpoint not found'}));
 app.use((error,req,res,next)=>{const status=error.status|| (error.errorNum===1?409:error.errorNum===2292?409:500);if(status>=500)console.error('Request failed',error.code||error.name);res.status(status).json({success:false,message:status>=500&&!error.status?'서버 처리에 실패했습니다.':error.errorNum===1?'이미 존재하는 데이터입니다.':error.message});});
 return app;
}
if(require.main===module)db.initializePool().then(()=>{const server=createApp().listen(Number(process.env.PORT||3000),'0.0.0.0',()=>console.log('O1BO API ready'));process.on('SIGTERM',()=>server.close(async()=>{await(await db.initializePool()).close(10);process.exit(0)}));}).catch(error=>{console.error('Database initialization failed',error.code||error.name);process.exit(1)});
module.exports={createApp};
