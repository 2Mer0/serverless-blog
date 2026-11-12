const { app } = require("@azure/functions");
const store = require("../store");
const guard = require("../guard");

app.http("CreatePost", {
  methods: ["POST"],
  authLevel: "anonymous",
  route: "posts",
  handler: async (request, context) => {
    const principal = guard.parsePrincipal(request);
    if (!guard.isSignedIn(principal)) {
      return { status: 401, jsonBody: { error: "You must be signed in to publish" } };
    }

    if (await store.isBanned(principal.userId)) {
      return { status: 403, jsonBody: { error: "Your account is blocked from publishing on this blog" } };
    }

    let data;
    try {
      data = await request.json();
    } catch {
      return { status: 400, jsonBody: { error: "Invalid JSON" } };
    }

    try {
      const post = await store.create({
        title: data.title,
        body: data.body,
        author: principal.userDetails || "Anonymous",
        authorId: principal.userId,
        imageUrl: data.imageUrl
      });
      return { status: 201, jsonBody: post };
    } catch (err) {
      return { status: 400, jsonBody: { error: err.message } };
    }
  }
});
