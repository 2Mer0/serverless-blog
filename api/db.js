// db.js — the only file that talks to Cosmos DB and Blob Storage.
const fs = require("fs");
const path = require("path");

// Two ways to configure Cosmos, so a long paste cannot break the app.
const COSMOS_CONN = process.env.COSMOS_CONNECTION;
const COSMOS_ENDPOINT = process.env.COSMOS_ENDPOINT;
const COSMOS_KEY = process.env.COSMOS_KEY;
const USE_COSMOS = Boolean(COSMOS_CONN || (COSMOS_ENDPOINT && COSMOS_KEY));

const STORAGE_CONN = process.env.STORAGE_CONNECTION;
const CONTAINER_NAME = process.env.STORAGE_CONTAINER || "images";

const LOCAL = path.join(__dirname, "data");

// ───────────────────── local fallback (runs with no Azure) ─────────────────────
function readLocal(file) {
  try { return JSON.parse(fs.readFileSync(path.join(LOCAL, file), "utf8")); }
  catch { return []; }
}
function writeLocal(file, data) {
  if (!fs.existsSync(LOCAL)) fs.mkdirSync(LOCAL, { recursive: true });
  fs.writeFileSync(path.join(LOCAL, file), JSON.stringify(data, null, 2));
}

const local = {
  async allPosts() {
    return readLocal("posts.json").sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  async addPost(post) {
    const posts = readLocal("posts.json");
    posts.push(post);
    writeLocal("posts.json", posts);
    return post;
  },
  async deleteItem(id) {
    const posts = readLocal("posts.json");
    const next = posts.filter(p => p.id !== id);
    writeLocal("posts.json", next);
    return next.length !== posts.length;
  },
  async allBans() { return readLocal("bans.json"); },
  async putBan(doc) {
    const bans = readLocal("bans.json").filter(b => b.id !== doc.id);
    bans.push(doc);
    writeLocal("bans.json", bans);
    return doc;
  },
  async deleteBan(id) {
    const bans = readLocal("bans.json");
    const next = bans.filter(b => b.id !== id);
    writeLocal("bans.json", next);
    return next.length !== bans.length;
  },
  async saveImage(buffer, name) {
    const dir = path.join(__dirname, "..", "images");
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), buffer);
    return "/images/" + name;
  }
};

// ───────────────────── Cosmos DB ─────────────────────
let containerPromise = null;

function container() {
  if (!containerPromise) {
    const { CosmosClient } = require("@azure/cosmos");
    const client = COSMOS_CONN
      ? new CosmosClient(COSMOS_CONN)
      : new CosmosClient({ endpoint: COSMOS_ENDPOINT, key: COSMOS_KEY });
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

const cloud = {
  // Bans live in the same container, tagged with bannedDevice.
  async allPosts() {
    const { resources } = await (await container())
      .items.query("SELECT * FROM c WHERE IS_DEFINED(c.deviceId) AND NOT IS_DEFINED(c.bannedDevice) ORDER BY c.createdAt DESC")
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
  async deleteBan(id) { return cloud.deleteItem(id); },
  async saveImage(buffer, name) {
    const c = await blobContainer();
    const blob = c.getBlockBlobClient(name);
    await blob.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: "image/" + name.split(".").pop() }
    });
    return blob.url;
  }
};

const store = USE_COSMOS ? cloud : local;

module.exports = {
  // ───── posts ─────
  async listPosts() {
    const posts = await store.allPosts();
    const bans = await store.allBans();
    if (!bans.length) return posts;
    const blocked = new Set(bans.map(b => b.bannedDevice));
    return posts.filter(p => !blocked.has(p.deviceId));
  },

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

  async deletePost(id) { return store.deleteItem(id); },

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

  // ───── images ─────
  async saveImage({ filename, contentType, data }) {
    const allowed = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };
    const ext = allowed[contentType];
    if (!ext) throw new Error("Only PNG, JPEG, GIF or WebP allowed");
    if (!data || typeof data !== "string") throw new Error("No image data");
    if (USE_COSMOS && !STORAGE_CONN) throw new Error("Image storage is not configured");

    const buf = Buffer.from(data, "base64");
    if (!buf.length) throw new Error("Image is empty");
    if (buf.length > 5 * 1024 * 1024) throw new Error("Image must be 5 MB or smaller");

    const safe = String(filename || "image")
      .replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 30) || "image";
    const name = Date.now() + "-" + Math.random().toString(16).slice(2, 8) + "-" + safe + "." + ext;
    return { url: await store.saveImage(buf, name), bytes: buf.length };
  }
};
