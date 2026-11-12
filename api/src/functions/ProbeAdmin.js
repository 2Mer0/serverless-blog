const { app } = require("@azure/functions");

app.http("ProbeAdmin", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "probeadmin",
  handler: async () => ({ jsonBody: { ok: true, route: "probeadmin" } })
});
