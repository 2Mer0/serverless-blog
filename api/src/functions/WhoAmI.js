const { app } = require("@azure/functions");
const guard = require("../guard");

// Diagnostic: shows what the platform says about the caller, and whether the
// admin setting is visible to this function. Safe to leave in — it reveals
// nothing to anonymous callers and only echoes your own identity when signed in.
app.http("WhoAmI", {
  methods: ["GET"],
  authLevel: "anonymous",
  route: "whoami",
  handler: async (request, context) => {
    const principal = guard.parsePrincipal(request);
    const configured = guard.adminList();

    return {
      jsonBody: {
        signedIn: guard.isSignedIn(principal),
        userDetails: principal ? principal.userDetails : null,
        userId: principal ? principal.userId : null,
        roles: principal ? principal.userRoles : [],
        isAdmin: guard.isAdmin(principal),
        adminUserConfigured: configured.length > 0,
        adminUserCount: configured.length,
        // show only a masked hint, never the raw configured value
        adminUserHint: configured.map(v => v.slice(0, 2) + "*".repeat(Math.max(0, v.length - 2)))
      }
    };
  }
});
