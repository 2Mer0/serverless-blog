
// Local dev server. Serves index.html AND the /api routes on one port,
// exactly like the deployed Static Web App (where /api is internal, no CORS).
//   node server.js
// The function files are the real ones Azure runs; this file only stands in
// for the Functions host so you need no extra installs.

const http = require("http");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const PORT = 7071;
const routes = [];

// --- stand in for @azure/functions so the real function files load unchanged ---
const fakeApp = {
  http(name, opts) {
    routes.push({
      name,
      methods: (opts.methods || ["GET"]).map(m => m.toUpperCase()),
      pattern: new RegExp("^/" + (opts.route || name).replace(/\{[^}]+\}/g, "([^/]+)") + "$"),
      keys: ((opts.route || name).match(/\{[^}]+\}/g) || []).map(s => s.slice(1, -1)),
      handler: opts.handler
    });
  }
};
const SHIM = "@azure/functions-devshim";
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === "@azure/functions") return SHIM;
  return origResolve.call(this, request, ...rest);
};
require.cache[SHIM] = { id: SHIM, filename: SHIM, loaded: true, exports: { app: fakeApp } };

require("./api/src/index.js");
console.log("Loaded functions: " + routes.map(r => r.name).join(", "));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");

  // ---- API ----
  if (url.pathname.startsWith("/api/")) {
    const sub = url.pathname.slice(4);
    for (const r of routes) {
      if (!r.methods.includes(req.method)) continue;
      const m = r.pattern.exec(sub);
      if (!m) continue;

      const params = {};
      r.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));

      let body = "";
      for await (const chunk of req) body += chunk;

      const request = {
        method: req.method,
        url: req.url,
        headers: req.headers,
        params,
        query: url.searchParams,
        json: async () => JSON.parse(body || "{}"),
        text: async () => body
      };

      let out;
      try {
        out = await r.handler(request, { log: console.log, error: console.error });
      } catch (err) {
        console.error(r.name, err);
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Server error" }));
      }

      const status = out.status || 200;
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify(out.jsonBody !== undefined ? out.jsonBody : out.body || {}));
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "No function matched " + req.method + " " + url.pathname }));
  }

  // ---- static files ----
  let file = path.join(__dirname, url.pathname === "/" ? "index.html" : url.pathname);
  if (!file.startsWith(__dirname)) { res.writeHead(403); return res.end(); }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      return res.end("Not found: " + url.pathname);
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, () => console.log("\n  Blog running at  http://localhost:" + PORT + "\n"));
