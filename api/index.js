
const { app } = require("@azure/functions");
const db = require("./db");

const isAdmin = (request) =>
  Boolean(process.env.ADMIN_KEY) &&
  request.headers.get("x-admin-key") === process.env.ADMIN_KEY;

const clientIp = (request) => {
  const raw = (request.headers.get("x-forwarded-for") || "").split(",")[0].trim();
  if (!raw) return "unknown";

  const v4 = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
  if (v4) return v4[1];
  const v6 = raw.match(/^\[?([0-9a-fA-F:]+)\]?(?::\d+)?$/);
  if (v6 && raw.indexOf(":") !== -1) return v6[1];
  return raw;
};

const json = (status, body) => ({ status, jsonBody: body });

app.http("listPosts", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "posts",
  handler: async (request) => {

    const posts = isAdmin(request) ? await db.listPostsRaw() : await db.listPosts();
    return json(200, posts);
  }
});

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

    if (await db.isPaused()) {
      return json(403, { error: "Posting is paused by the moderator" });
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

    if (await db.isPaused()) {
      return json(403, { error: "Posting is paused by the moderator" });
    }
    try {
      return json(201, await db.saveImage(body || {}));
    } catch (err) {
      return json(400, { error: err.message });
    }
  }
});

app.http("listComments", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "comments/{postId}",
  handler: async (request) => {
    return json(200, {
      comments: await db.listComments(request.params.postId),
      paused: await db.isPaused()
    });
  }
});

app.http("createComment", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "comments",
  handler: async (request) => {
    let body;
    try { body = await request.json(); } catch { return json(400, { error: "Invalid JSON" }); }

    const deviceId = String((body && body.deviceId) || "").slice(0, 64);
    const ip = clientIp(request);
    if (!deviceId) return json(400, { error: "Missing device id" });
    if (await db.isBlocked(deviceId)) {
      return json(403, { error: "This device is blocked from commenting" });
    }
    try {
      const comment = await db.createComment({
        postId: body.postId, name: body.name, body: body.body, deviceId, ip
      });
      return json(201, comment);
    } catch (err) {
      return json(400, { error: err.message });
    }
  }
});

app.http("deleteComment", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "comments/{id}",
  handler: async (request) => {
    if (!isAdmin(request)) return json(403, { error: "Admin key required" });
    const ok = await db.deleteComment(request.params.id);
    return ok ? json(200, { deleted: request.params.id }) : json(404, { error: "Not found" });
  }
});

app.http("modstate", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "modstate",
  handler: async () => json(200, await db.getPosting())
});

app.http("moderation", {
  methods: ["GET", "POST"],
  authLevel: "anonymous",
  route: "mod",
  handler: async (request) => {
    if (!isAdmin(request)) return json(403, { error: "Admin key required" });

    if (request.method === "GET") {
      return json(200, {
        bans: await db.listBans(),
        posting: await db.getPosting()
      });
    }

    let body;
    try { body = await request.json(); } catch { return json(400, { error: "Invalid JSON" }); }

    const action = String((body && body.action) || "");

    if (action === "pause" || action === "resume") {
      const doc = await db.setPosting(action === "pause", body.reason);
      return json(200, { posting: { paused: doc.paused, since: doc.pausedAt, reason: doc.reason } });
    }

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
    return json(400, { error: "action must be block, unblock, pause or resume" });
  }
});
