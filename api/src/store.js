// Single place that touches the data.
// Deployed: Cosmos DB.  Locally (no COSMOS_CONNECTION set): JSON files.
const fs = require("fs");
const path = require("path");

// Two ways to configure Cosmos, so a long paste can't break the app:
//   1. COSMOS_CONNECTION  = full connection string
//   2. COSMOS_ENDPOINT + COSMOS_KEY
const CONN = process.env.COSMOS_CONNECTION;
const ENDPOINT = process.env.COSMOS_ENDPOINT;
const KEY = process.env.COSMOS_KEY;
const USE_COSMOS = Boolean(CONN || (ENDPOINT && KEY));

const DATA = path.join(__dirname, "..", "data");
const POSTS_FILE = path.join(DATA, "posts.json");
const BANS_FILE = path.join(DATA, "bans.json");

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

// ---------- local fallback ----------
const fileStore = {
  async list() {
    return readJson(POSTS_FILE).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  async get(id) {
    return readJson(POSTS_FILE).find(p => p.id === id) || null;
  },
  async create(post) {
    const posts = readJson(POSTS_FILE);
    posts.push(post);
    fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2));
    return post;
  },
  async remove(id) {
    const posts = readJson(POSTS_FILE);
    const next = posts.filter(p => p.id !== id);
    fs.writeFileSync(POSTS_FILE, JSON.stringify(next, null, 2));
    return next.length !== posts.length;
  },
  async listBans() {
    return readJson(BANS_FILE);
  },
  async ban(doc) {
    const bans = readJson(BANS_FILE).filter(b => b.id !== doc.id);
    bans.push(doc);
    fs.writeFileSync(BANS_FILE, JSON.stringify(bans, null, 2));
    return doc;
  },
  async unban(id) {
    const bans = readJson(BANS_FILE);
    const next = bans.filter(b => b.id !== id);
    fs.writeFileSync(BANS_FILE, JSON.stringify(next, null, 2));
    return next.length !== bans.length;
  }
};

// ---------- Cosmos DB ----------
// Bans live in the same container, marked by a bannedUserId field,
// so no extra container has to be created.
let containerPromise = null;

function getContainer() {
  if (!containerPromise) {
    const { CosmosClient } = require("@azure/cosmos");
    const client = CONN
      ? new CosmosClient(CONN)
      : new CosmosClient({ endpoint: ENDPOINT, key: KEY });
    containerPromise = Promise.resolve(client.database("blogdb").container("posts"));
  }
  return containerPromise;
}

const cosmosStore = {
  async list() {
    const { resources } = await (await getContainer())
      .items.query("SELECT * FROM c WHERE NOT IS_DEFINED(c.bannedUserId) ORDER BY c.createdAt DESC")
      .fetchAll();
    return resources;
  },
  async get(id) {
    const { resource } = await (await getContainer()).item(id, id).read();
    return resource && !resource.bannedUserId ? resource : null;
  },
  async create(post) {
    const { resource } = await (await getContainer()).items.create(post);
    return resource;
  },
  async remove(id) {
    try {
      await (await getContainer()).item(id, id).delete();
      return true;
    } catch (err) {
      if (err.code === 404) return false;
      throw err;
    }
  },
  async listBans() {
    const { resources } = await (await getContainer())
      .items.query("SELECT * FROM c WHERE IS_DEFINED(c.bannedUserId)")
      .fetchAll();
    return resources.sort((a, b) => (a.bannedAt < b.bannedAt ? 1 : -1));
  },
  async ban(doc) {
    const { resource } = await (await getContainer()).items.upsert(doc);
    return resource;
  },
  async unban(id) {
    return cosmosStore.remove(id);
  }
};

const store = USE_COSMOS ? cosmosStore : fileStore;

async function bannedIdSet() {
  const bans = await store.listBans();
  return new Set(bans.map(b => b.bannedUserId));
}

module.exports = {
  // Everything, for the admin view.
  async listAll() {
    return store.list();
  },
  // What visitors see: posts by blocked accounts are hidden.
  // Reversible — unblocking restores their posts.
  async list() {
    const posts = await store.list();
    const banned = await bannedIdSet();
    if (!banned.size) return posts;
    return posts.filter(p => !banned.has(p.authorId));
  },
  async get(id) {
    const post = await store.get(id);
    if (!post) return null;
    const banned = await bannedIdSet();
    return banned.has(post.authorId) ? null : post;
  },
  // Raw lookup that ignores bans (admin deletes).
  async getAny(id) {
    return store.get(id);
  },
  async create({ title, body, author, imageUrl, authorId }) {
    const post = {
      id: String(Date.now()) + Math.random().toString(16).slice(2, 6),
      title: String(title || "").trim(),
      body: String(body || "").trim(),
      author: String(author || "Amir").trim(),
      authorId: authorId || null,
      imageUrl: typeof imageUrl === "string" && imageUrl ? imageUrl : null,
      createdAt: new Date().toISOString()
    };
    if (!post.title || !post.body) {
      throw new Error("Title and body are required");
    }
    return store.create(post);
  },
  async remove(id) {
    return store.remove(id);
  },
  async listBans() {
    return store.listBans();
  },
  async banUser({ userId, userDetails, reason, bannedBy }) {
    if (!userId) throw new Error("userId is required");
    return store.ban({
      id: "ban:" + userId,
      bannedUserId: userId,
      userDetails: String(userDetails || ""),
      reason: String(reason || "").slice(0, 200),
      bannedBy: String(bannedBy || ""),
      bannedAt: new Date().toISOString()
    });
  },
  async unbanUser(userId) {
    return store.unban("ban:" + userId);
  },
  async isBanned(userId) {
    if (!userId) return false;
    const bans = await store.listBans();
    return bans.some(b => b.bannedUserId === userId);
  }
};
