import worker from '../dist/server/index.js';
import { database } from '../lib/postgres.js';

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const path = url.searchParams.get('__route');
    if (path !== null) {
      url.pathname = '/' + path;
      url.searchParams.delete('__route');
    } else if (url.pathname === '/api/handler') {
      url.pathname = '/';
    }
    const headers = new Headers(request.headers);
    headers.delete('CF-Connecting-IP');
    const ip = headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
    if (ip) headers.set('CF-Connecting-IP', ip);
    const forwarded = new Request(url, { method: request.method, headers, body: request.body, duplex: 'half' });
    let DB;
    if (url.pathname.startsWith('/api/') && process.env.DATABASE_URL) {
      try {
        DB = await database(process.env.DATABASE_URL);
      } catch {
        return Response.json({ error: 'Requests are temporarily unavailable. Try again shortly.' }, { status: 503 });
      }
    }
    return worker.fetch(forwarded, { DB });
  }
};
