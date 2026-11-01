const crypto=require('node:crypto');
const {promisify}=require('node:util');
const {fail}=require('./validation');
const scrypt=promisify(crypto.scrypt);
let active=0;
async function derive(password,salt){
 if(active>=2)fail(503,'로그인 요청이 많습니다. 잠시 후 다시 시도해 주세요.');
 active++;
 try{return await scrypt(password,salt,64,{N:32768,r:8,p:3,maxmem:64*1024*1024});}finally{active--;}
}
function email(value){
 if(typeof value!=='string')fail(400,'이메일 아이디를 입력해 주세요.');
 const result=value.trim().toLowerCase();
 if(Buffer.byteLength(result)>255||! /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result))fail(400,'올바른 이메일 아이디를 입력해 주세요.');
 return result;
}
function password(value){
 if(typeof value!=='string'||Array.from(value).length<15||Array.from(value).length>128||Buffer.byteLength(value)>512)fail(400,'비밀번호는 15~128자로 입력해 주세요.');
 return value;
}
async function makeHash(value){const salt=crypto.randomBytes(16).toString('hex');const key=await derive(value,salt);return `scrypt$32768$8$3$${salt}$${key.toString('hex')}`;}
async function verify(value,encoded){
 const match=/^scrypt\$32768\$8\$3\$([a-f0-9]{32})\$([a-f0-9]{128})$/.exec(encoded||'');
 // Unknown accounts perform the same KDF work; no password or hash is logged.
 const key=await derive(value,match?match[1]:'0'.repeat(32));
 return !!match&&crypto.timingSafeEqual(key,Buffer.from(match[2],'hex'));
}
module.exports={email,password,makeHash,verify};
