// Run over SSH only. The code is printed once and expires after 10 minutes.
const crypto=require('node:crypto');const db=require('../db');const {hash}=require('../lib/validation');
(async()=>{const uid=process.argv[2];if(!uid)throw new Error('Usage: node scripts/issue-login-code.js USER_ID');
const user=(await db.executeQuery('SELECT UID_VAL FROM USERS WHERE UID_VAL=:id',{id:uid})).rows[0];if(!user)throw new Error('User not found');
const code=crypto.randomBytes(32).toString('base64url');await db.executeQuery('INSERT INTO LOGIN_CODES(TOKEN_HASH,USER_ID,EXPIRES_AT) VALUES(:hash,:id,:expires)',{hash:hash(code),id:uid,expires:Date.now()+600000});console.log(code);await (await db.initializePool()).close(0);})().catch(e=>{console.error(e.message);process.exit(1)});
