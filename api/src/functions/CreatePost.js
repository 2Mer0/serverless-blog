
const { app } = require("@azure/functions");
const store = require("../store");

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
    try {
      const post = await store.create(data);
      return { status: 201, jsonBody: post };
    } catch (err) {
      return { status: 400, jsonBody: { error: err.message } };
    }
  }
});
