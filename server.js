const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const db = require('./db');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const root = __dirname;
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-admin';

const marketData = [
  ['BTCUSDT', 'BTC', 'Bitcoin'], ['ETHUSDT', 'ETH', 'Ethereum'],
  ['BNBUSDT', 'BNB', 'BNB'], ['SOLUSDT', 'SOL', 'Solana'],
  ['AVAXUSDT', 'AVAX', 'Avalanche'], ['ADAUSDT', 'ADA', 'Cardano'],
  ['DOTUSDT', 'DOT', 'Polkadot'], ['DOGEUSDT', 'DOGE', 'Dogecoin'],
  ['XRPUSDT', 'XRP', 'XRP'], ['ARBUSDT', 'ARB', 'Arbitrum'],
  ['LINKUSDT', 'LINK', 'Chainlink'], ['APTUSDT', 'APT', 'Aptos']
].map(([symbol, coin, name]) => ({ symbol, coin, name, price: null, change24h: null }));

function json(response, status, body) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  response.end(JSON.stringify(body));
}

function notFound(response) {
  json(response, 404, { error: 'not_found' });
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) request.destroy();
    });
    request.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(new Error('invalid_json')); }
    });
    request.on('error', reject);
  });
}

function validEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function adminAuthorized(request) {
  return request.headers['x-admin-key'] === ADMIN_KEY;
}

function serveFile(request, response, pathname) {
  const requested = pathname === '/' ? '/app.html' : pathname;
  const filePath = path.resolve(root, `.${requested}`);
  if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return notFound(response);
  }
  const extensions = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.jpg': 'image/jpeg', '.otf': 'font/otf' };
  response.writeHead(200, { 'Content-Type': extensions[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
}

async function handleApi(request, response, url) {
  const route = url.pathname;
  if (request.method === 'OPTIONS') return json(response, 204, {});

  if (routeIsAdmin(url.pathname)) {
    if (!adminAuthorized(request)) return json(response, 401, { error: 'admin_unauthorized' });
    if (request.method === 'GET' && url.pathname === '/api/admin/users') return json(response, 200, { users: await db.listUsers() });
    if (request.method === 'POST') {
      let body;
      try { body = await readBody(request); } catch { return json(response, 400, { error: 'invalid_json' }); }
      if (url.pathname === '/api/admin/users') {
        if (!validEmail(body.email) || typeof body.username !== 'string' || !body.username.trim()) return json(response, 400, { error: 'invalid_account' });
        const result = await db.createUser({ email: body.email.trim(), username: body.username.trim() });
        return result.error ? json(response, 409, result) : json(response, 201, result);
      }
      if (url.pathname === '/api/admin/status') {
        const result = await db.updateUserStatus(body.uid, body.status);
        return result ? json(response, result.error ? 400 : 200, result) : json(response, 404, { error: 'user_not_found' });
      }
      if (url.pathname === '/api/admin/adjust-balance') {
        const result = await db.adjustAsset(body.uid, body);
        return json(response, result.error ? (result.error === 'user_not_found' ? 404 : 400) : 200, result);
      }
    }
  }

  if (request.method === 'GET' && route === '/api/health') return json(response, 200, { ok: true });
  if (request.method === 'GET' && route === '/api/balance') {
    const result = await db.getBalance(url.searchParams.get('uid'));
    return result ? json(response, 200, result) : json(response, 404, { error: 'user_not_found' });
  }
  if (request.method === 'GET' && route === '/api/assets') {
    const result = await db.getAssets(url.searchParams.get('uid'));
    return result ? json(response, 200, result) : json(response, 404, { error: 'user_not_found' });
  }
  if (request.method === 'GET' && route === '/api/address') {
    const result = await db.getAddresses(url.searchParams.get('uid'));
    return result ? json(response, 200, result) : json(response, 404, { error: 'user_not_found' });
  }
  if (request.method === 'GET' && route === '/api/addresses') return json(response, 200, { addresses: [] });
  if (request.method === 'GET' && route === '/api/markets') return json(response, 200, { markets: marketData });

  if (request.method === 'POST') {
    let body;
    try { body = await readBody(request); } catch { return json(response, 400, { error: 'invalid_json' }); }

    if (route === '/api/account-exists') {
      if (!validEmail(body.email)) return json(response, 400, { error: 'invalid_email' });
      const result = await db.loginByEmail(body.email);
      return json(response, 200, result ? { exists: true, username: result.username } : { exists: false });
    }
    if (route === '/api/login-by-email') {
      if (!validEmail(body.email)) return json(response, 400, { error: 'invalid_email' });
      const result = await db.loginByEmail(body.email);
      return json(response, 200, result || { exists: false });
    }
    if (route === '/api/account') {
      if (!validEmail(body.email) || typeof body.username !== 'string' || !body.username.trim()) return json(response, 400, { error: 'invalid_account' });
      const result = await db.createUser({ email: body.email.trim(), username: body.username.trim() });
      return result.error ? json(response, 409, result) : json(response, 201, result);
    }
    if (route === '/api/send' || route === '/api/send-to-site') {
      const result = await db.sendFunds(body.uid, body);
      if (route === '/api/send-to-site' && !result.error) result.success = true;
      return result.error ? json(response, result.error === 'user_not_found' ? 404 : 400, result) : json(response, 200, result);
    }
  }
  return notFound(response);
}

function routeIsAdmin(route) {
  return route === '/api/admin/users' || route === '/api/admin/status' || route === '/api/admin/adjust-balance';
}

function requestHandler(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || `${HOST}:${PORT}`}`);
  if (url.pathname.startsWith('/api/')) return handleApi(request, response, url).catch(() => json(response, 500, { error: 'server_error' }));
  if (request.method !== 'GET' && request.method !== 'HEAD') return notFound(response);
  return serveFile(request, response, decodeURIComponent(url.pathname));
}

module.exports = requestHandler;

if (require.main === module) {
  const server = http.createServer(requestHandler);
  server.listen(PORT, HOST, () => {
    console.log(`Binance clone server running at http://${HOST}:${PORT}`);
  });

  function shutdown() {
    server.close(() => process.exit(0));
  }
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}