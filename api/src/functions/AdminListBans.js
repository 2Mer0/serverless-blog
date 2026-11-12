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

app.http("AdminListBans", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "modbans",
  handler: async (request, context) => {
    const { error } = requireAdmin(request);
    if (error) return error;
    return { jsonBody: await store.listBans() };
  }
});
