// Copy every Storage object from the old project to the new one, preserving bucket, path and content-type.
//
// Inputs:
//   manifest.json            — [{bucket, name, size, mimetype}] listed from storage.objects of the OLD project (fresh, at cutover)
//   NEW_SUPABASE_URL         — https://mjsyjnlmjwdeykezxmul.supabase.co
//   NEW_SERVICE_ROLE_KEY     — service_role key of the NEW project (read from the local env file, never printed)
//
// Source downloads use the OLD project's public bucket URLs (all three buckets are public), so no old key is needed.
// Uploads use upsert:false — an existing object at the same path is treated as an error, never silently overwritten.
// After upload every object is re-listed on the new project and its size compared with the manifest.

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const OLD_REF = "ndvcqgrpsqykhodiyrhx";
const NEW_URL = process.env.NEW_SUPABASE_URL;
const NEW_KEY = process.env.NEW_SERVICE_ROLE_KEY;
const manifestPath = process.argv[2] || "manifest.json";
if (!NEW_URL || !NEW_KEY) { console.error("NEW_SUPABASE_URL / NEW_SERVICE_ROLE_KEY missing"); process.exit(2); }

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const sb = createClient(NEW_URL, NEW_KEY, { auth: { persistSession: false } });

// 1. buckets (public flags come from the manifest's bucket list)
const buckets = [...new Map(manifest.buckets.map(b => [b.id, b])).values()];
for (const b of buckets) {
  const { data: existing } = await sb.storage.getBucket(b.id);
  if (!existing) {
    const { error } = await sb.storage.createBucket(b.id, { public: !!b.public });
    if (error) { console.error(`bucket ${b.id}: ${error.message}`); process.exit(1); }
    console.log(`bucket created: ${b.id} (public=${!!b.public})`);
  } else if (!!existing.public !== !!b.public) {
    const { error } = await sb.storage.updateBucket(b.id, { public: !!b.public });
    if (error) { console.error(`bucket ${b.id} update: ${error.message}`); process.exit(1); }
    console.log(`bucket updated: ${b.id} (public=${!!b.public})`);
  } else {
    console.log(`bucket ok: ${b.id}`);
  }
}

// 2. objects
let ok = 0, failed = [];
for (const o of manifest.objects) {
  const src = `https://${OLD_REF}.supabase.co/storage/v1/object/public/${o.bucket}/${o.name.split("/").map(encodeURIComponent).join("/")}`;
  try {
    const res = await fetch(src);
    if (!res.ok) throw new Error(`download HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (o.size != null && buf.length !== Number(o.size)) throw new Error(`size mismatch on download: got ${buf.length}, expected ${o.size}`);
    const { error } = await sb.storage.from(o.bucket).upload(o.name, buf, { contentType: o.mimetype || "application/octet-stream", upsert: false });
    if (error) throw new Error(`upload: ${error.message}`);
    ok++;
    console.log(`copied ${o.bucket}/${o.name} (${buf.length} bytes)`);
  } catch (e) {
    failed.push({ ...o, error: String(e.message || e) });
    console.error(`FAILED ${o.bucket}/${o.name}: ${e.message || e}`);
  }
}

// 3. verify by re-listing on the new project
let verified = 0, mismatched = [];
for (const o of manifest.objects) {
  const dir = o.name.includes("/") ? o.name.slice(0, o.name.lastIndexOf("/")) : "";
  const base = o.name.slice(dir ? dir.length + 1 : 0);
  const { data, error } = await sb.storage.from(o.bucket).list(dir, { limit: 1000, search: base });
  const hit = (data || []).find(f => f.name === base);
  if (error || !hit) { mismatched.push({ ...o, error: error?.message || "not found after upload" }); continue; }
  const newSize = hit.metadata?.size;
  if (o.size != null && Number(newSize) !== Number(o.size)) { mismatched.push({ ...o, error: `size ${newSize} != ${o.size}` }); continue; }
  verified++;
}

console.log(`\ncopied ${ok}/${manifest.objects.length}, verified ${verified}/${manifest.objects.length}`);
if (failed.length || mismatched.length) {
  console.error("failures:", JSON.stringify([...failed, ...mismatched], null, 2));
  process.exit(1);
}
