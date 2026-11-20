// Deploy ./dist to Firebase Hosting via the REST API (equivalent to `firebase deploy --only hosting`).
// Usage: TOKEN=... PROJECT=... node deploy-hosting.mjs <distDir>
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { gzipSync, constants } from "node:zlib";
import { createHash } from "node:crypto";

const { TOKEN, PROJECT } = process.env;
const dist = process.argv[2];
const site = PROJECT;
const api = "https://firebasehosting.googleapis.com/v1beta1";
const H = { Authorization: `Bearer ${TOKEN}`, "X-Goog-User-Project": PROJECT, "Content-Type": "application/json" };

async function call(method, url, body) {
  const r = await fetch(url, { method, headers: H, body: body ? JSON.stringify(body) : undefined });
  const t = await r.text();
  if (!r.ok) throw new Error(`${method} ${url} -> ${r.status} ${t.slice(0, 400)}`);
  return t ? JSON.parse(t) : {};
}

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const files = walk(dist).filter((p) => !p.endsWith(".map"));
const byHash = new Map();
const manifest = {};
for (const f of files) {
  const gz = gzipSync(readFileSync(f), { level: constants.Z_BEST_COMPRESSION });
  const hash = createHash("sha256").update(gz).digest("hex");
  manifest["/" + relative(dist, f)] = hash;
  byHash.set(hash, gz);
}

const fb = JSON.parse(readFileSync(new URL("../firebase.json", import.meta.url)));
const config = {
  rewrites: fb.hosting.rewrites.map((r) => ({ glob: r.source, path: r.destination })),
  headers: fb.hosting.headers.map((h) => ({ glob: h.source, headers: Object.fromEntries(h.headers.map((x) => [x.key, x.value])) })),
};

const version = await call("POST", `${api}/sites/${site}/versions`, { config });
console.log("version", version.name);
const pop = await call("POST", `${api}/${version.name}:populateFiles`, { files: manifest });
const need = pop.uploadRequiredHashes ?? [];
console.log("files", files.length, "to upload", need.length);
for (const h of need) {
  const r = await fetch(`${pop.uploadUrl}/${h}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "X-Goog-User-Project": PROJECT, "Content-Type": "application/octet-stream" },
    body: byHash.get(h),
  });
  if (!r.ok) throw new Error(`upload ${h} -> ${r.status} ${await r.text()}`);
}
await call("PATCH", `${api}/${version.name}?updateMask=status`, { status: "FINALIZED" });
const rel = await call("POST", `${api}/sites/${site}/releases?versionName=${encodeURIComponent(version.name)}`, { message: "Airlock deploy" });
console.log("released", rel.name, "->", `https://${site}.web.app`);
