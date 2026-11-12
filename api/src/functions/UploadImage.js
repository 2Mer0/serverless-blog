const { app } = require("@azure/functions");
const storage = require("../storage");
const store = require("../store");
const guard = require("../guard");

app.http("UploadImage", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "upload",
  handler: async (request, context) => {
    const principal = guard.parsePrincipal(request);
    if (!guard.isSignedIn(principal)) {
      return { status: 401, jsonBody: { error: "You must be signed in" } };
    }
    if (await store.isBanned(principal.userId)) {
      return { status: 403, jsonBody: { error: "Your account is blocked from publishing on this blog" } };
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Invalid JSON" } };
    }

    try {
      const result = await storage.saveImage(body || {});
      return { status: 201, jsonBody: result };
    } catch (err) {
      return { status: 400, jsonBody: { error: err.message } };
    }
  }
});
