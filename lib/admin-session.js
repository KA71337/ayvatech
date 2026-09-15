import { createHmac, createHash, timingSafeEqual, randomBytes, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from './github.js';
const derive=promisify(scrypt);
const lifetime=60*60;
// Configuration means the two server-only variables are present. Strength is an
// operational concern and must not make valid Vercel variables look missing.
export const authConfigured=()=> Boolean(process.env.ADMIN_PASSWORD?.trim() && process.env.SESSION_SECRET?.trim());
export function equal(a,b) {
  const hash=v=>createHash('sha256').update(String(v)).digest();
  return timingSafeEqual(hash(a),hash(b));
}
function sign(payload) {
  // Password rotation also invalidates every previously issued session.
  return createHmac('sha256',process.env.SESSION_SECRET).update(process.env.ADMIN_PASSWORD).update('\0'+payload).digest('base64url');
}
export function issueSession(admin=false, now=Date.now()) {
  if (!authConfigured()) throw new HttpError(503,'AUTH_CONFIG','Set a strong ADMIN_PASSWORD (16+ characters) and SESSION_SECRET (32+ characters).');
  const session={admin,csrf:randomBytes(32).toString('hex'),exp:Math.floor(now/1000)+lifetime};
  const payload=Buffer.from(JSON.stringify(session)).toString('base64url');
  return {session,value:payload+'.'+sign(payload)};
}
export function readSession(req, now=Date.now()) {
  if (!authConfigured()) return null;
  const value=req.headers.cookie?.match(/(?:^|;\s*)ayva.sid=([A-Za-z0-9_.-]+)(?:;|$)/)?.[1];
  if (!value || value.length>1000) return null;
  const [payload,signature,extra]=value.split('.');
  if (extra || !signature || !equal(signature,sign(payload))) return null;
  try {
    const s=JSON.parse(Buffer.from(payload,'base64url').toString());
    return typeof s.admin==='boolean' && /^[a-f0-9]{64}$/.test(s.csrf) && Number.isInteger(s.exp) && s.exp>Math.floor(now/1000) && s.exp<=Math.floor(now/1000)+lifetime ? s : null;
  } catch { return null; }
}
export function cookie(value, clear=false) {
  return `ayva.sid=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear?0:lifetime}${process.env.NODE_ENV==='production'?'; Secure':''}`;
}
export function requireCSRF(req, session, body={}) {
  const host=req.headers.host;
  const origin=req.headers.origin;
  const allowed=process.env.SITE_URL || `${process.env.NODE_ENV==='production'?'https':'http'}://${host}`;
  if ((origin && origin!==new URL(allowed).origin) || req.headers['sec-fetch-site']==='cross-site' || !session || !equal(req.headers['x-csrf-token']||body._csrf||'',session.csrf)) throw new HttpError(403,'CSRF','Invalid request token. Reload the page.');
}
export async function checkPassword(password) {
  if (!authConfigured() || typeof password!=='string' || password.length>1024) return false;
  const salt=process.env.SESSION_SECRET;
  const [actual,expected]=await Promise.all([derive(password,salt,32),derive(process.env.ADMIN_PASSWORD,salt,32)]);
  return timingSafeEqual(actual,expected);
}
// Best-effort per-instance defense only. Configure Vercel Firewall rate limiting
// for /api/admin/login as the shared, serverless-wide brute-force defense.
const attempts=new Map();
export function limitLogin(req, now=Date.now()) {
  const key=req.headers['x-vercel-forwarded-for']||req.socket?.remoteAddress||'unknown';
  for (const [k,v] of attempts) if (v.until<now) attempts.delete(k);
  const entry=attempts.get(key)||{count:0,until:now+15*60*1000};
  if (entry.count>=10 || attempts.size>=10000) throw new HttpError(429,'LOGIN_LIMIT','Too many sign-in attempts. Try again later.');
  entry.count++; attempts.set(key,entry);
}
