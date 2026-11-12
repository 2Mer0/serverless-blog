
const { app } = require("@azure/functions");
const store = require("../store");

app.http("GetPosts", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "posts",
  handler: async (request, context) => {
    const posts = await store.list();
    return { jsonBody: posts };
  }
});
