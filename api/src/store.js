
// Single place that touches the data.
// Now: a JSON file. At step 3: Cosmos DB. Nothing else in the app changes.
const fs = require("fs");
const path = require("path");

const FILE = path.join(__dirname, "..", "data", "posts.json");

function readAll() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return [];
  }
}

function writeAll(posts) {
  fs.writeFileSync(FILE, JSON.stringify(posts, null, 2));
}

module.exports = {
  async list() {
    return readAll().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  },
  async get(id) {
    return readAll().find(p => p.id === id) || null;
  },
  async create({ title, body, author }) {
    const posts = readAll();
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
    posts.push(post);
    writeAll(posts);
    return post;
  }
};
