// Local development/test adapter only. Vercel serves dist and api/admin.js directly.
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import handler from '../api/admin.js';
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.webp':'image/webp','.jpg':'image/jpeg','.png':'image/png','.svg':'image/svg+xml','.xml':'application/xml','.txt':'text/plain; charset=utf-8'};
export function createPreview({adminHandler=handler, directory='dist', mediaDirectory}={}) {
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const route = decodeURIComponent(url.pathname);
      if (/^\/admin(?:\/|$)/.test(route) || /^\/api\/admin(?:\/|$)/.test(route)) {
        const mapped = route.startsWith('/api/') ? route.slice('/api/admin'.length).replace(/^\//,'') : 'page' + route.slice('/admin'.length);
        req.query = {route:mapped || url.searchParams.get('route') || ''};
        return await adminHandler(req, res);
      }
      if (!['GET','HEAD'].includes(req.method)) {res.writeHead(405); return res.end();}
      if (/^(\/(ru|en))?\/contact$/.test(route)) {res.writeHead(308,{Location:route+'s'}); return res.end();}
      if (route.includes('\\') || route.split('/').some(p => p.startsWith('.'))) {res.writeHead(404); return res.end();}
      const root = path.resolve(directory);
      let file = path.resolve(root, '.' + route);
      if (!file.startsWith(root + path.sep) && file !== root) {res.writeHead(404); return res.end();}
      if (mediaDirectory && route.startsWith('/media/')) {
        const media = path.resolve(mediaDirectory, '.' + route);
        if (await stat(media).catch(()=>null)) file = media;
      }
      let info = await stat(file).catch(()=>null);
      if (info?.isDirectory()) file = path.join(file, 'index.html');
      else if (!info && !path.extname(file)) file += '.html';
      let body;
      try {body = await readFile(file);} catch {res.statusCode=404; file=path.join(root,'404.html'); body=await readFile(file);}
      res.setHeader('Content-Type', types[path.extname(file)] || 'application/octet-stream');
      res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
      res.end(req.method==='HEAD'?undefined:body);
    } catch {res.writeHead(500); res.end('Preview failed. Run npm run build first.');}
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const server = createPreview();
  server.listen(Number(process.env.PORT)||3000, '127.0.0.1', () => console.log('Local preview: http://127.0.0.1:' + server.address().port));
}
