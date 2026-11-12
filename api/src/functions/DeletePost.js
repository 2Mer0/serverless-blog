const { app } = require("@azure/functions");
const store = require("../store");
const guard = require("../guard");

app.http("DeletePost", {
  methods: ["DELETE"],
  authLevel: "anonymous",
  route: "posts/{id}",
  handler: async (request, context) => {
    const principal = guard.parsePrincipal(request);
    if (!guard.isAdmin(principal)) {
      return { status: 403, jsonBody: { error: "Admin only" } };
    }
    const removed = await store.remove(request.params.id);
    if (!removed) return { status: 404, jsonBody: { error: "Not found" } };
    context.log("admin removed post " + request.params.id);
    return { status: 200, jsonBody: { deleted: request.params.id } };
  }
});
