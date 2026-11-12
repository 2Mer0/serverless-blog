const { app } = require("@azure/functions");
const store = require("../store");
const guard = require("../guard");

function requireAdmin(request) {
  const principal = guard.parsePrincipal(request);
  if (!guard.isSignedIn(principal)) {
    return { error: { status: 401, jsonBody: { error: "You must be signed in" } } };
  }
  if (!guard.isAdmin(principal)) {
    return { error: { status: 403, jsonBody: { error: "Admin only" } } };
  }
  return { principal };
}

// List every post, including author ids, so the admin can see who to ban.
app.http("AdminListPosts", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "admin/posts",
  handler: async (request, context) => {
    const { error } = requireAdmin(request);
    if (error) return error;
    return { jsonBody: await store.listAll() };
  }
});

// List currently banned accounts.
app.http("AdminListBans", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "admin/bans",
  handler: async (request, context) => {
    const { error } = requireAdmin(request);
    if (error) return error;
    return { jsonBody: await store.listBans() };
  }
});

// Ban an account: POST { userId, userDetails, reason }
app.http("AdminBanUser", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "admin/ban",
  handler: async (request, context) => {
    const { principal, error } = requireAdmin(request);
    if (error) return error;

    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Invalid JSON" } };
    }
    if (!body || !body.userId) {
      return { status: 400, jsonBody: { error: "userId is required" } };
    }
    if (body.userId === principal.userId) {
      return { status: 400, jsonBody: { error: "You cannot ban yourself" } };
    }

    const doc = await store.banUser({
      userId: body.userId,
      userDetails: body.userDetails,
      reason: body.reason,
      bannedBy: principal.userDetails
    });
    context.log("admin banned " + body.userDetails + " (" + body.userId + ")");
    return { status: 201, jsonBody: doc };
  }
});

// Unban: POST { userId }
app.http("AdminUnbanUser", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "admin/unban",
  handler: async (request, context) => {
    const { error } = requireAdmin(request);
    if (error) return error;

    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Invalid JSON" } };
    }
    if (!body || !body.userId) {
      return { status: 400, jsonBody: { error: "userId is required" } };
    }
    const removed = await store.unbanUser(body.userId);
    return { status: 200, jsonBody: { unbanied: body.userId, found: removed } };
  }
});
