// Guards for writing content: who is allowed, and what words are rejected.
const PROFANITY = [
  "fuck", "shit", "bitch", "bastard", "asshole", "dickhead", "cunt",
  "motherfucker", "twat", "wanker", "prick", "slut", "whore", "retard"
];

// Normalise so simple evasions (F.U.C.K, fffuuuck, f u c k) still match.
function normalise(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")   // drop punctuation/spacing tricks
    .replace(/(.)\1+/g, "$1")      // collapse every repeated letter: fuuuuck -> fuck
    .replace(/\s+/g, " ");
}

function findProfanity(text) {
  const flat = normalise(text).replace(/\s/g, "");
  return PROFANITY.filter(w => flat.includes(w));
}

// ALLOWED_AUTHORS="2Mer0,other"  -> only these GitHub/Entra handles may post.
// Unset -> any signed-in user may post.
function authorsAllowed(userDetails) {
  const list = (process.env.ALLOWED_AUTHORS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  return list.includes(String(userDetails || "").toLowerCase());
}

function parsePrincipal(request) {
  const raw = request.headers && request.headers["x-ms-client-principal"];
  if (!raw) return null;
  try {
    return JSON.parse(Buffer.from(raw, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

// Returns an error object to send back, or null when the write is allowed.
function checkWrite(request, fields) {
  const principal = parsePrincipal(request);

  // The platform blocks unauthenticated POSTs via staticwebapp.config.json.
  // This is defence in depth, and it also covers direct function invocation.
  if (process.env.REQUIRE_AUTH === "true") {
    if (!principal || !(principal.userRoles || []).includes("authenticated")) {
      return { status: 401, error: "You must be signed in to publish" };
    }
    if (!authorsAllowed(principal.userDetails)) {
      return { status: 403, error: "This account is not allowed to publish here" };
    }
  }

  for (const [name, value] of Object.entries(fields)) {
    if (typeof value !== "string") continue;
    const hits = findProfanity(value);
    if (hits.length) {
      return { status: 400, error: "Blocked: content contains prohibited language" };
    }
  }

  return null;
}

module.exports = { checkWrite, parsePrincipal, findProfanity, authorsAllowed, normalise };
