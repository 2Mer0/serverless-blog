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

// Admin = the identity configured in ADMIN_USER (e.g. "2Mer0").
// Accepts a comma-separated list, and matches the handle OR the display name,
// because identity providers return either one in userDetails.
// With no ADMIN_USER set, nobody is admin — safer than everyone being admin.
function adminList() {
  return ADMIN.split(",").map(s => s.trim()).filter(Boolean);
}

function isAdmin(principal) {
  if (!isSignedIn(principal)) return false;
  const list = adminList();
  if (!list.length) return false;

  const candidates = [principal.userDetails, principal.userId]
    .filter(Boolean)
    .map(v => String(v).trim().toLowerCase());

  return candidates.some(c => list.includes(c));
}

module.exports = { parsePrincipal, isSignedIn, isAdmin, adminList };
