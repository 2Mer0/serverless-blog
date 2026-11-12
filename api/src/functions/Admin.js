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

// Routes are kept flat (no slashes) — managed functions in Static Web Apps
// did not resolve nested paths reliably, so /api/adminposts instead of
// /api/admin/posts. Simpler to debug, and nothing else depends on the shape.

// Every post, including author ids, so the admin can see who to ban.
app.http("AdminListPosts", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "adminposts",
  handler: async (request, context) => {
    const { error } = requireAdmin(request);
    if (error) return error;
    return { jsonBody: await store.listAll() };
  }
});

app.http("AdminListBans", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "adminbans",
  handler: async (request, context) => {
    const { error } = requireAdmin(request);
    if (error) return error;
    return { jsonBody: await store.listBans() };
  }
});

// Ban: POST { userId, userDetails, reason }
app.http("AdminBanUser", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "adminban",
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
  route: "adminunban",
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
    return { status: 200, jsonBody: { unblocked: body.userId, found: removed } };
  }
});
