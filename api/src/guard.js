// Who may do what. The platform forbids anonymous writes (staticwebapp.config.json);
// this module decides admin rights and ban status on top of that.
const ADMIN = (process.env.ADMIN_USER || "").toLowerCase();

// Azure Functions gives a WHATWG Headers object (.get), while the local dev
// server gives a plain object — support both, or auth silently fails in Azure.
function headerValue(headers, name) {
  if (!headers) return undefined;
  if (typeof headers.get === "function") return headers.get(name) || undefined;
  return headers[name] !== undefined ? headers[name] : headers[name.toLowerCase()];
}

function parsePrincipal(request) {
  const raw = headerValue(request && request.headers, "x-ms-client-principal");
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
