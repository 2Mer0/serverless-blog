// Who may do what. The platform forbids anonymous writes (staticwebapp.config.json);
// this module decides admin rights and ban status on top of that.
const ADMIN = (process.env.ADMIN_USER || "").toLowerCase();

function parsePrincipal(request) {
  const raw = request.headers && request.headers["x-ms-client-principal"];
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function isSignedIn(principal) {
  return Boolean(principal && (principal.userRoles || []).includes("authenticated"));
}

// Admin = the handle configured in ADMIN_USER (e.g. "2Mer0").
// With no ADMIN_USER set, nobody is admin — safer than everyone being admin.
function isAdmin(principal) {
  if (!isSignedIn(principal) || !ADMIN) return false;
  return String(principal.userDetails || "").toLowerCase() === ADMIN;
}

module.exports = { parsePrincipal, isSignedIn, isAdmin };
