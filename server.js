'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const port = process.env.PORT || 8080;
const root = process.cwd();

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
	'.png': 'image/png',
	'.jpg': 'image/jpeg',
	'.jpeg': 'image/jpeg',
	'.webp': 'image/webp',
};

function send(res, status, body, headers) {
	res.writeHead(status, Object.assign({
		'Cache-Control': 'no-store',
		'X-Content-Type-Options': 'nosniff',
	}, headers || {}));
	res.end(body);
}

function serveStatic(req, res) {
	try {
		const urlPath = (req.url || '/').split('?')[0];
		const safePath = urlPath === '/' ? '/index.html' : urlPath;
		const filePath = path.normalize(path.join(root, safePath));
		if (!filePath.startsWith(root)) {
			return send(res, 403, 'Forbidden');
		}
		fs.readFile(filePath, (err, data) => {
			if (err) return send(res, 404, 'Not found');
			const ext = path.extname(filePath);
			const type = MIME[ext] || 'application/octet-stream';
			send(res, 200, data, { 'Content-Type': type });
		});
	} catch (e) {
		send(res, 500, 'Server error');
	}
}

http.createServer(serveStatic).listen(port, () => {
	console.log(`Serving on http://localhost:${port}`);
});


