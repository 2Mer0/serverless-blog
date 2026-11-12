const { app } = require("@azure/functions");

app.http("ProbeAlpha", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "probealpha",
  handler: async () => ({ jsonBody: { ok: true, route: "probealpha" } })
});
