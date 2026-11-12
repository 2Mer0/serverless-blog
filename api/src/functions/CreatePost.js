const { app } = require("@azure/functions");
const store = require("../store");
const guard = require("../guard");

app.http("CreatePost", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "posts",
  handler: async (request, context) => {
    let data;
    try {
      data = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Invalid JSON" } };
    }

    const denied = guard.checkWrite(request, {
      title: data && data.title,
      body: data && data.body
    });
    if (denied) {
      context.log("blocked write: " + denied.error);
      return { status: denied.status, jsonBody: { error: denied.error } };
    }

    const principal = guard.parsePrincipal(request);
    try {
      const post = await store.create({
        title: data.title,
        body: data.body,
        author: (principal && principal.userDetails) || data.author || "Anonymous",
        imageUrl: data.imageUrl
      });
      return { status: 201, jsonBody: post };
    } catch (err) {
      return { status: 400, jsonBody: { error: err.message } };
    }
  }
});
