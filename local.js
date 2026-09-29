const http = require('node:http');
const requestHandler = require('./server');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const server = http.createServer(requestHandler);

server.listen(PORT, HOST, () => {
  console.log(`Binance clone server running at http://${HOST}:${PORT}`);
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);