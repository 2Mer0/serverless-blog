// Dev only — runs api/index.js locally without Azure tooling.
//   node server.js    →  http://localhost:7071
const http = require("http");
const fs = require("fs");
const path = require("path");
const Module = require("module");

const PORT = Number(process.env.PORT || 7071);
const routes = [];

// stand in for @azure/functions
const fakeApp = {
  http: function (name, opts) {
    routes.push({
      name: name,
      methods: (opts.methods || ["GET"]).map(function (m) { return m.toUpperCase(); }),
      pattern: new RegExp("^/" + opts.route.replace(/\{[^}]+\}/g, "([^/]+)") + "$"),
      keys: (opts.route.match(/\{[^}]+\}/g) || []).map(function (s) { return s.slice(1, -1); }),
      handler: opts.handler
    });
  }
};

const SHIM = "@azure/functions-devshim";
const orig = Module._resolveFilename;
Module._resolveFilename = function (req) {
  const rest = Array.prototype.slice.call(arguments, 1);
  if (req === "@azure/functions") return SHIM;
  return orig.apply(this, [req].concat(rest));
};
require.cache[SHIM] = { id: SHIM, filename: SHIM, loaded: true, exports: { app: fakeApp } };

require("./api/index.js");
console.log("endpoints: " + routes.map(function (r) {
  return r.methods.join("|") + " /" + r.name;
}).join(", "));

const TYPES = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".json": "application/json",
  ".png": "image/png", ".jpg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp"
};

const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, "http://localhost");

  if (url.pathname.indexOf("/api/") === 0) {
    const sub = url.pathname.slice(4);

    for (let i = 0; i < routes.length; i++) {
      const r = routes[i];
      if (r.methods.indexOf(req.method) === -1) continue;
      const m = r.pattern.exec(sub);
      if (!m) continue;

      const params = {};
      r.keys.forEach(function (k, n) { params[k] = decodeURIComponent(m[n + 1]); });

      let raw = "";
      for await (const c of req) raw += c;

      const request = {
        method: req.method, url: req.url, params: params,
        headers: { get: function (n) { return req.headers[String(n).toLowerCase()]; } },
        json: async function () { return JSON.parse(raw || "{}"); },
        text: async function () { return raw; }
      };

      let out;
      try {
        out = await r.handler(request, { log: console.log });
      } catch (e) {
        console.error(r.name, e);
        res.writeHead(500, { "Content-Type": "application/json" });
        return res.end('{"error":"Server error"}');
      }

      const status = out.status || 200;
      const payload = out.jsonBody !== undefined ? out.jsonBody : (out.body || {});
      res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
      return res.end(JSON.stringify(payload));
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "No route for " + req.method + " " + url.pathname }));
  }

  if (url.pathname.indexOf("/images/") === 0) {
    const f = path.join(__dirname, url.pathname);
    return fs.readFile(f, function (err, data) {
      if (err) { res.writeHead(404); return res.end("not found"); }
      res.writeHead(200, { "Content-Type": TYPES[path.extname(f)] || "application/octet-stream" });
      res.end(data);
    });
  }

  const file = path.join(__dirname, url.pathname === "/" ? "index.html" : url.pathname);
  fs.readFile(file, function (err, data) {
    if (err) { res.writeHead(404, { "Content-Type": "text/plain" }); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    res.end(data);
  });
});

server.listen(PORT, function () {
  console.log("http://localhost:" + PORT);
});
