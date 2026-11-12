// Single place that touches the data.
// Deployed: Cosmos DB.  Locally (no COSMOS_CONNECTION set): a JSON file.
const fs = require("fs");
const path = require("path");

const CONN = process.env.COSMOS_CONNECTION;
const FILE = path.join(__dirname, "..", "data", "posts.json");

// ---------- local fallback: JSON file ----------
const fileStore = {
  async list() {
    try {
      return JSON.parse(fs.readFileSync(FILE, "utf8")).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    } catch {
      return [];
    }
  },
  async get(id) {
    return (await fileStore.list()).find(p => p.id === id) || null;
  },
  async create(post) {
    const posts = await fileStore.list();
    posts.push(post);
    fs.writeFileSync(FILE, JSON.stringify(posts, null, 2));
    return post;
  }
};

// ---------- Cosmos DB ----------
let containerPromise = null;

function getContainer() {
  if (!containerPromise) {
    const { CosmosClient } = require("@azure/cosmos");
    const client = new CosmosClient(CONN);
    containerPromise = Promise.resolve(client.database("blogdb").container("posts"));
  }
  return containerPromise;
}

const cosmosStore = {
  async list() {
    const { resources } = await (await getContainer())
      .items.query("SELECT * FROM c ORDER BY c.createdAt DESC")
      .fetchAll();
    return resources;
  },
  async get(id) {
    const { resource } = await (await getContainer()).item(id, id).read();
    return resource || null;
  },
  async create(post) {
    const { resource } = await (await getContainer()).items.create(post);
    return resource;
  }
};

const store = CONN ? cosmosStore : fileStore;

module.exports = {
  async list() {
    return store.list();
  },
  async get(id) {
    return store.get(id);
  },
  async create({ title, body, author }) {
    const post = {
      id: String(Date.now()) + Math.random().toString(16).slice(2, 6),
      title: String(title || "").trim(),
      body: String(body || "").trim(),
      author: String(author || "Amir").trim(),
      createdAt: new Date().toISOString()
    };
    if (!post.title || !post.body) {
      throw new Error("Title and body are required");
    }
    return store.create(post);
  }
};
