// Fixed-window, process-local limiter. Cap memory without evicting active entries:
// when saturated, reject new identities instead of letting them bypass limits.
function createLimiter({max=180, windowMs=60000, capacity=10000, clock=Date.now}={}) {
  const entries=new Map();
  let sweepAt=0;
  return key => {
    const now=clock();
    if(now>=sweepAt){
      for(const [id,entry] of entries)if(entry.until<=now)entries.delete(id);
      sweepAt=now+windowMs;
    }
    let entry=entries.get(key);
    if(!entry||entry.until<=now){
      if(!entry&&entries.size>=capacity)return false;
      entry={count:0,until:now+windowMs};entries.set(key,entry);
    }
    return ++entry.count<=max;
  };
}

function securityHeaders(req,res,next){
  res.set({
    'Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff',
    'Referrer-Policy':'no-referrer',
    'X-Frame-Options':'DENY',
    'Content-Security-Policy':"default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"
  });
  // req.secure honors only configured trusted proxies, never arbitrary forwarded headers.
  if(req.secure)res.set('Strict-Transport-Security','max-age=31536000');
  next();
}

function errorHandler(error,req,res,next){
  if(res.headersSent)return next(error);
  const requested=Number(error.status);
  const status=Number.isInteger(requested)&&requested>=400&&requested<=599?requested:
    [1,2292].includes(error.errorNum)?409:500;
  const safe={
    'entity.parse.failed':'올바른 JSON 요청이 필요합니다.',
    'entity.too.large':'요청 데이터가 너무 큽니다.',
    'encoding.unsupported':'지원하지 않는 요청 인코딩입니다.'
  };
  // Parser messages can contain the submitted body. Never echo them or DB internals.
  const message=safe[error.type]||(error.errorNum===1?'이미 존재하는 데이터입니다.':
    error.errorNum===2292?'연결된 기록이 있어 삭제할 수 없습니다.':
    status>=500&&!error.expose?'서버 처리에 실패했습니다.':error.message);
  if(status>=500)console.error('Request failed',error.code||error.name);
  res.status(status).json({success:false,message});
}
module.exports={createLimiter,securityHeaders,errorHandler};
