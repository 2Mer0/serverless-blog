const { app } = require("@azure/functions");
const storage = require("../storage");
const guard = require("../guard");

app.http("UploadImage", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "upload",
  handler: async (request, context) => {
    let body;
    try {
      body = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Invalid JSON" } };
    }

    const denied = guard.checkWrite(request, { filename: body && body.filename });
    if (denied) {
      return { status: denied.status, jsonBody: { error: denied.error } };
    }

    try {
      const result = await storage.saveImage(body || {});
      return { status: 201, jsonBody: result };
    } catch (err) {
      return { status: 400, jsonBody: { error: err.message } };
    }
  }
});
