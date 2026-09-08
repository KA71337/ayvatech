import session from 'express-session';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { timingSafeEqual, createHash, randomBytes } from 'node:crypto';
export function equal(a,b){const hash=v=>createHash('sha256').update(String(v)).digest();return timingSafeEqual(hash(a),hash(b));}
export function authConfigured(){return (process.env.ADMIN_PASSWORD?.length||0)>=12 && (process.env.SESSION_SECRET?.length||0)>=32;}
export function createSessionStore(){
  const dir=path.resolve(process.env.DATA_DIR||'data','sessions');mkdirSync(dir,{recursive:true});
  const db=new DatabaseSync(path.join(dir,'sessions.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, data TEXT NOT NULL, expires INTEGER NOT NULL)');
  class SQLiteStore extends session.Store {
    get(id,cb){try{const row=db.prepare('SELECT data FROM sessions WHERE id=? AND expires>?').get(id,Date.now());cb(null,row?JSON.parse(row.data):null);}catch(e){cb(e);}}
    set(id,value,cb=()=>{}){try{db.prepare('DELETE FROM sessions WHERE expires<?').run(Date.now());db.prepare('INSERT OR REPLACE INTO sessions VALUES (?,?,?)').run(id,JSON.stringify(value),Date.now()+8*60*60*1000);cb();}catch(e){cb(e);}}
    destroy(id,cb=()=>{}){try{db.prepare('DELETE FROM sessions WHERE id=?').run(id);cb();}catch(e){cb(e);}}
    touch(id,value,cb=()=>{}){this.set(id,value,cb);}
  }
  return new SQLiteStore();
}
export function csrfToken(req){if(!req.session.csrf)req.session.csrf=randomBytes(32).toString('hex');return req.session.csrf;}
export function requireAdmin(req,res,next){if(!authConfigured()||!req.session.admin){if(req.path.startsWith('/api/'))return res.status(401).json({error:'Unauthorized'});return res.redirect('/admin/login');}next();}
export function requireCSRF(req,res,next){
  const origin=req.get('origin');
  const allowed=process.env.SITE_URL?new URL(process.env.SITE_URL).origin:`${req.protocol}://${req.get('host')}`;
  const token=req.get('x-csrf-token')||req.body?._csrf;
  if((origin&&origin!==allowed)||!req.session.csrf||typeof token!=='string'||!equal(token,req.session.csrf))return res.status(403).json({error:'Invalid request token'});
  next();
}
