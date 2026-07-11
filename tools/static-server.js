const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const port = Number(process.env.PORT || 8000);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json'
};

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://127.0.0.1:${port}`);
  let filePath = path.normalize(path.join(root, decodeURIComponent(url.pathname)));

  if (!filePath.startsWith(root)) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  fs.stat(filePath, (statError, stats) => {
    if (statError) {
      response.writeHead(404);
      response.end('Not found');
      return;
    }

    if (stats.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    fs.readFile(filePath, (readError, data) => {
      if (readError) {
        response.writeHead(500);
        response.end('Error');
        return;
      }

      response.writeHead(200, {
        'Content-Type': types[path.extname(filePath)] || 'application/octet-stream'
      });
      response.end(data);
    });
  });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`DOZECLIN local: http://127.0.0.1:${port}/app/login.html`);
});
