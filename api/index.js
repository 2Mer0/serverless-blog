// index.js — all five endpoints in one file.
const { app } = require("@azure/functions");
const db = require("./db");

// ─────────── helpers ───────────
const isAdmin = (request) =>
  Boolean(process.env.ADMIN_KEY) &&
  request.headers.get("x-admin-key") === process.env.ADMIN_KEY;

// Azure puts the caller's IP in x-forwarded-for; the first entry is the origin.
const clientIp = (request) =>
  (request.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "unknown";

const json = (status, body) => ({ status, jsonBody: body });

// ─────────── GET /api/posts ───────────
app.http("listPosts", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "posts",
  handler: async (request) => {
    // The admin panel needs every post, including blocked ones.
    const posts = isAdmin(request) ? await db.listPostsRaw() : await db.listPosts();
    return json(200, posts);
  }
});

// ─────────── POST /api/posts ───────────
app.http("createPost", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "posts",
  handler: async (request) => {
    let body;
    try { body = await request.json(); } catch { return json(400, { error: "Invalid JSON" }); }

    const deviceId = String((body && body.deviceId) || "").slice(0, 64);
    const ip = clientIp(request);

    if (!deviceId) return json(400, { error: "Missing device id" });
    if (await db.isBlocked(deviceId)) {
      return json(403, { error: "This device is blocked from posting" });
    }

    try {
      const post = await db.createPost({
        title: body.title, body: body.body, imageUrl: body.imageUrl, deviceId, ip
      });
      return json(201, post);
    } catch (err) {
      return json(400, { error: err.message });
    }
  }
});

// ─────────── DELETE /api/posts/{id} ───────────
app.http("deletePost", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "posts/{id}",
  handler: async (request) => {
    if (!isAdmin(request)) return json(403, { error: "Admin key required" });
    const ok = await db.deletePost(request.params.id);
    return ok ? json(200, { deleted: request.params.id }) : json(404, { error: "Not found" });
  }
});

// ─────────── POST /api/upload ───────────
app.http("uploadImage", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "upload",
  handler: async (request) => {
    let body;
    try { body = await request.json(); } catch { return json(400, { error: "Invalid JSON" }); }

    const deviceId = String((body && body.deviceId) || "").slice(0, 64);
    if (deviceId && await db.isBlocked(deviceId)) {
      return json(403, { error: "This device is blocked" });
    }
    try {
      return json(201, await db.saveImage(body || {}));
    } catch (err) {
      return json(400, { error: err.message });
    }
  }
});

// ─────────── GET / POST /api/mod ───────────
//   GET  → { bans: [...] }
//   POST → { action:"block",   deviceId, ip, reason }
//        → { action:"unblock", deviceId }
app.http("moderation", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "mod",
  handler: async (request) => {
    if (!isAdmin(request)) return json(403, { error: "Admin key required" });

    if (request.method === "GET") {
      return json(200, { bans: await db.listBans() });
    }

    let body;
    try { body = await request.json(); } catch { return json(400, { error: "Invalid JSON" }); }

    const action = String((body && body.action) || "");
    const deviceId = String((body && body.deviceId) || "").slice(0, 64);
    if (!deviceId) return json(400, { error: "deviceId is required" });

    if (action === "block") {
      const doc = await db.blockDevice({ deviceId, ip: body.ip, reason: body.reason });
      return json(201, doc);
    }
    if (action === "unblock") {
      const ok = await db.unblockDevice(deviceId);
      return json(200, { unblocked: deviceId, found: ok });
    }
    return json(400, { error: "action must be block or unblock" });
  }
});
