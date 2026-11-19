// db.js — the only file that talks to Cosmos DB and Blob Storage.
const STORAGE_CONN = process.env.STORAGE_CONNECTION;
const CONTAINER_NAME = process.env.STORAGE_CONTAINER || "images";

// ───────────────────── Cosmos DB ─────────────────────
// The client is built once and reused across requests.
let containerPromise = null;

function container() {
  if (!containerPromise) {
    const { CosmosClient } = require("@azure/cosmos");
    const client = new CosmosClient({
      endpoint: process.env.COSMOS_ENDPOINT,
      key: process.env.COSMOS_KEY
    });
    containerPromise = Promise.resolve(client.database("blogdb").container("posts"));
  }
  return containerPromise;
}

// ───────────────────── Blob Storage ─────────────────────
let blobPromise = null;

function blobContainer() {
  if (!blobPromise) {
    const { BlobServiceClient } = require("@azure/storage-blob");
    const svc = BlobServiceClient.fromConnectionString(STORAGE_CONN);
    blobPromise = Promise.resolve(svc.getContainerClient(CONTAINER_NAME));
  }
  return blobPromise;
}

// One container holds three kinds of document, told apart by which field is present:
//   posts    → deviceId, no commentOn, no bannedDevice
//   comments → commentOn
//   bans     → bannedDevice
//   settings → a single document with a fixed id, no deviceId
const store = {
  async allPosts() {
    const { resources } = await (await container())
      .items.query("SELECT * FROM c WHERE IS_DEFINED(c.deviceId) AND NOT IS_DEFINED(c.bannedDevice) AND NOT IS_DEFINED(c.commentOn) ORDER BY c.createdAt DESC")
      .fetchAll();
    return resources;
  },
  async addPost(post) {
    const { resource } = await (await container()).items.create(post);
    return resource;
  },
  async deleteItem(id) {
    try {
      await (await container()).item(id, id).delete();
      return true;
    } catch (err) {
      if (err.code === 404) return false;
      throw err;
    }
  },
  async allBans() {
    const { resources } = await (await container())
      .items.query("SELECT * FROM c WHERE IS_DEFINED(c.bannedDevice)")
      .fetchAll();
    return resources.sort((a, b) => (a.bannedAt < b.bannedAt ? 1 : -1));
  },
  async putBan(doc) {
    const { resource } = await (await container()).items.upsert(doc);
    return resource;
  },
  async deleteBan(id) { return store.deleteItem(id); },

  // ── comments ──
  async commentsFor(postId) {
    const { resources } = await (await container())
      .items.query({
        query: "SELECT * FROM c WHERE IS_DEFINED(c.commentOn) AND c.commentOn = @p ORDER BY c.createdAt ASC",
        parameters: [{ name: "@p", value: postId }]
      })
      .fetchAll();
    return resources;
  },
  async addComment(doc) {
    const { resource } = await (await container()).items.create(doc);
    return resource;
  },

  // ── the single settings document ──
  async settingsDoc() {
    try {
      const { resource } = await (await container()).item("settings:posting", "settings:posting").read();
      return resource;
    } catch (err) {
      if (err.code === 404) return null;
      throw err;
    }
  },
  async putSetting(doc) {
    const { resource } = await (await container()).items.upsert(doc);
    return resource;
  },

  async saveImage(buffer, name) {
    const c = await blobContainer();
    const blob = c.getBlockBlobClient(name);
    await blob.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: "image/" + name.split(".").pop() }
    });
    return blob.url;
  }
};

module.exports = {
  // ───── posts ─────
  // Visitors see posts from unblocked devices only.
  async listPosts() {
    const posts = await store.allPosts();
    const bans = await store.allBans();
    if (!bans.length) return posts;
    const blocked = new Set(bans.map(b => b.bannedDevice));
    return posts.filter(p => !blocked.has(p.deviceId));
  },

  // The admin panel sees everything, including blocked devices' posts.
  async listPostsRaw() { return store.allPosts(); },

  async createPost({ title, body, deviceId, ip, imageUrl }) {
    const post = {
      id: String(Date.now()) + Math.random().toString(16).slice(2, 6),
      title: String(title || "").trim().slice(0, 140),
      body: String(body || "").trim().slice(0, 4000),
      deviceId: String(deviceId || "unknown").slice(0, 64),
      ip: String(ip || "unknown").slice(0, 45),
      imageUrl: typeof imageUrl === "string" && imageUrl ? imageUrl : null,
      createdAt: new Date().toISOString()
    };
    if (!post.title || !post.body) throw new Error("Title and body are required");
    return store.addPost(post);
  },

  // Deleting a post removes its comments too, so none are orphaned.
  async deletePost(id) {
    const comments = await store.commentsFor(id);
    for (const c of comments) {
      try { await store.deleteItem(c.id); } catch { /* already gone */ }
    }
    return store.deleteItem(id);
  },

  // ───── comments ─────
  // A blocked device's comments are hidden, the same way its posts are.
  async listComments(postId) {
    const [comments, bans] = await Promise.all([store.commentsFor(postId), store.allBans()]);
    if (!bans.length) return comments;
    const blocked = new Set(bans.map(b => b.bannedDevice));
    return comments.filter(c => !blocked.has(c.deviceId));
  },

  async createComment({ postId, name, body, deviceId, ip }) {
    if (!postId) throw new Error("postId is required");
    const text = String(body || "").trim().slice(0, 600);
    if (!text) throw new Error("Comment cannot be empty");
    return store.addComment({
      id: "cm:" + Date.now() + Math.random().toString(16).slice(2, 6),
      commentOn: String(postId).slice(0, 64),
      name: String(name || "").trim().slice(0, 60) || "Anonymous",
      body: text,
      deviceId: String(deviceId || "unknown").slice(0, 64),
      ip: String(ip || "unknown").slice(0, 45),
      createdAt: new Date().toISOString()
    });
  },

  async deleteComment(id) { return store.deleteItem(id); },

  // ───── bans ─────
  async listBans() { return store.allBans(); },

  async blockDevice({ deviceId, ip, reason }) {
    if (!deviceId) throw new Error("deviceId is required");
    return store.putBan({
      id: "ban:" + deviceId,
      bannedDevice: String(deviceId).slice(0, 64),
      ip: String(ip || "unknown").slice(0, 45),
      reason: String(reason || "").slice(0, 160),
      bannedAt: new Date().toISOString()
    });
  },

  async unblockDevice(deviceId) { return store.deleteBan("ban:" + deviceId); },

  async isBlocked(deviceId) {
    if (!deviceId) return false;
    const bans = await store.allBans();
    return bans.some(b => b.bannedDevice === deviceId);
  },

  // ───── posting switch ─────
  // One document, id "settings:posting". Missing means posting is open.
  async getPosting() {
    const s = await store.settingsDoc();
    return {
      paused: Boolean(s && s.paused),
      since: (s && s.pausedAt) || null,
      reason: (s && s.reason) || ""
    };
  },

  async setPosting(paused, reason) {
    return store.putSetting({
      id: "settings:posting",
      paused: Boolean(paused),
      pausedAt: paused ? new Date().toISOString() : null,
      reason: String(reason || "").slice(0, 160),
      updatedAt: new Date().toISOString()
    });
  },

  async isPaused() {
    const s = await store.settingsDoc();
    return Boolean(s && s.paused);
  },

  // ───── images ─────
  async saveImage({ filename, contentType, data }) {
    const allowed = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
    const ext = allowed[contentType];
    if (!ext) throw new Error("Only PNG, JPEG, GIF or WebP allowed");
    if (!data || typeof data !== "string") throw new Error("No image data");
    if (!STORAGE_CONN) throw new Error("Image storage is not configured");

    const buf = Buffer.from(data, "base64");
    if (!buf.length) throw new Error("Image is empty");
    if (buf.length > 5 * 1024 * 1024) throw new Error("Image must be 5 MB or smaller");

    const safe = String(filename || "image")
      .replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 30) || "image";
    const name = Date.now() + "-" + Math.random().toString(16).slice(2, 8) + "-" + safe + "." + ext;
    return { url: await store.saveImage(buf, name), bytes: buf.length };
  }
};
