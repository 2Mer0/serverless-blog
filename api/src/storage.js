// Single place that stores images.
// Deployed: Azure Blob Storage.  Locally (no STORAGE_CONNECTION): a folder on disk.
const fs = require("fs");
const path = require("path");

const CONN = process.env.STORAGE_CONNECTION;
const CONTAINER = process.env.STORAGE_CONTAINER || "images";
const LOCAL_DIR = path.join(__dirname, "..", "..", "images");

const ALLOWED = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

function extFor(contentType) {
  return ALLOWED[contentType] || null;
}

function safeName(original) {
  const base = String(original || "image").replace(/\.[^.]+$/, "");
  return base.replace(/[^a-zA-Z0-9-_]/g, "").slice(0, 40) || "image";
}

// ---------- local fallback ----------
const localStore = {
  async save(buffer, name) {
    if (!fs.existsSync(LOCAL_DIR)) fs.mkdirSync(LOCAL_DIR, { recursive: true });
    fs.writeFileSync(path.join(LOCAL_DIR, name), buffer);
    return "/images/" + name;
  }
};

// ---------- Azure Blob Storage ----------
let containerPromise = null;

function getContainer() {
  if (!containerPromise) {
    const { BlobServiceClient } = require("@azure/storage-blob");
    const client = BlobServiceClient.fromConnectionString(CONN);
    containerPromise = Promise.resolve(client.getContainerClient(CONTAINER));
  }
  return containerPromise;
}

const blobStore = {
  async save(buffer, name) {
    const container = await getContainer();
    const blob = container.getBlockBlobClient(name);
    await blob.uploadData(buffer, {
      blobHTTPHeaders: { blobContentType: "image/" + name.split(".").pop() }
    });
    return blob.url;
  }
};

// In Azure the filesystem is read-only, so the local fallback would "succeed"
// and then serve a broken link. Fail loudly instead of pretending.
const IN_AZURE = Boolean(process.env.WEBSITE_INSTANCE_ID);
const store = CONN ? blobStore : localStore;

module.exports = {
  // returns { url } or throws Error with a user-safe message
  async saveImage({ filename, contentType, data }) {
    if (IN_AZURE && !CONN) {
      throw new Error("Image storage is not configured (STORAGE_CONNECTION is missing)");
    }
    const ext = extFor(contentType);
    if (!ext) throw new Error("Only PNG, JPEG, GIF or WebP images are allowed");

    if (!data || typeof data !== "string") throw new Error("No image data received");

    let buffer;
    try {
      buffer = Buffer.from(data, "base64");
    } catch {
      throw new Error("Image data is not valid base64");
    }

    if (!buffer.length) throw new Error("Image is empty");
    if (buffer.length > 5 * 1024 * 1024) throw new Error("Image must be 5 MB or smaller");

    const name = Date.now() + "-" + Math.random().toString(16).slice(2, 8) + "-" + safeName(filename) + "." + ext;
    const url = await store.save(buffer, name);
    return { url, bytes: buffer.length };
  }
};
