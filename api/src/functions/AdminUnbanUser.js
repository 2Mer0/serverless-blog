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
    if (!body || !body.userId) return { status: 400, jsonBody: { error: "userId is required" } };

    const removed = await store.unbanUser(body.userId);
    return { status: 200, jsonBody: { unblocked: body.userId, found: removed } };
  }
});
