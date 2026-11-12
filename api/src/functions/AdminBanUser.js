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
    if (!body || !body.userId) return { status: 400, jsonBody: { error: "userId is required" } };
    if (body.userId === principal.userId) return { status: 400, jsonBody: { error: "You cannot ban yourself" } };

    const doc = await store.banUser({
      userId: body.userId,
      userDetails: body.userDetails,
      reason: body.reason,
      bannedBy: principal.userDetails
    });
    context.log("admin banned " + body.userDetails);
    return { status: 201, jsonBody: doc };
  }
});
