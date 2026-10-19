const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '..');
const frontendRoot = path.join(projectRoot, 'frontend');
const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const server = http.createServer((request, response) => {
  if (request.method !== 'GET') {
    response.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    return response.end('Method not allowed');
  }

  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const relativePath = requestUrl.pathname === '/' ? 'index.html' : decodeURIComponent(requestUrl.pathname.slice(1));
  const filePath = path.resolve(frontendRoot, relativePath);
  if (!filePath.startsWith(`${frontendRoot}${path.sep}`) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return response.end('Not found');
  }

  response.writeHead(200, { 'Content-Type': mimeTypes[path.extname(filePath)] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(response);
});

if (require.main === module) {
  server.listen(port, host, () => console.log(`CashFlow berjalan di http://${host}:${port}`));
}
