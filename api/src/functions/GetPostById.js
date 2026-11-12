
const { app } = require("@azure/functions");
const store = require("../store");

app.http("GetPostById", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "posts/{id}",
  handler: async (request, context) => {
    const post = await store.get(request.params.id);
    if (!post) return { status: 404, jsonBody: { error: "Not found" } };
    return { jsonBody: post };
  }
});
