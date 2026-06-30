#!/usr/bin/env node
/*
 * Compress & optimize the site's documents and images.
 *
 *  - Pristine originals are preserved under ../originals/{documents,images}
 *    (these are NOT published — Hugo only serves ../static).
 *  - Compressed versions are written into ../static/{documents,images} at the
 *    SAME filenames, so every existing content link automatically serves the
 *    smaller file. Links don't need to change.
 *  - A compressed file is only kept if it is actually smaller than the original;
 *    otherwise the original is served unchanged.
 *  - Re-runnable: always compresses from the pristine original.
 *
 * PDFs  -> Ghostscript /ebook (≈150 dpi image downsampling, text preserved)
 * Images-> sharp (downscale very large images, re-encode jp/png/webp)
 */
import { readdir, mkdir, copyFile, stat, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { dirname, join, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const execFileP = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const STATIC = join(ROOT, "static");
const ORIG = join(ROOT, "originals");
const GS = process.env.GS_BIN || "C:/Users/cameronh/Ghostscript/bin/gswin64c.exe";

const MAX_IMG_W = 1600;          // cap very large images
const JPG_Q = 78, WEBP_Q = 80;
const TMP = join(__dirname, ".tmp_compress");

const fmt = (b) => (b / 1048576).toFixed(2) + " MB";
const sizeOf = async (p) => (await stat(p)).size;
let totOrig = 0, totNew = 0;
const rows = [];

async function ensure(p) { await mkdir(p, { recursive: true }); }

/** Get the pristine source for a served file: originals/ if present, else seed it from static/. */
async function pristine(kind, name) {
  const o = join(ORIG, kind, name);
  const s = join(STATIC, kind, name);
  if (!existsSync(o)) { await ensure(dirname(o)); await copyFile(s, o); }
  return o;
}

async function compressPdf(name) {
  const src = await pristine("documents", name);
  const dest = join(STATIC, "documents", name);
  const tmp = join(TMP, name);
  await ensure(TMP);
  try {
    await execFileP(GS, [
      "-sDEVICE=pdfwrite", "-dCompatibilityLevel=1.5", "-dPDFSETTINGS=/ebook",
      "-dNOPAUSE", "-dQUIET", "-dBATCH", "-dAutoRotatePages=/None",
      "-dDetectDuplicateImages=true", "-dCompressFonts=true", "-dSubsetFonts=true",
      "-sOutputFile=" + tmp, src,
    ], { maxBuffer: 1 << 26 });
  } catch (e) {
    rows.push({ file: name, note: "gs failed: " + (e.message || e).slice(0, 60) });
    await copyFile(src, dest);
    return;
  }
  const o = await sizeOf(src), n = await sizeOf(tmp);
  if (n > 0 && n < o * 0.97) { await copyFile(tmp, dest); totOrig += o; totNew += n;
    rows.push({ file: name, original: fmt(o), compressed: fmt(n), saved: ((1 - n / o) * 100).toFixed(0) + "%" });
  } else { await copyFile(src, dest); totOrig += o; totNew += o;
    rows.push({ file: name, original: fmt(o), compressed: fmt(o), saved: "0% (kept)" });
  }
  await rm(tmp, { force: true });
}

async function compressImage(name) {
  const ext = extname(name).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) return;
  const src = await pristine("images", name);
  const dest = join(STATIC, "images", name);
  const tmp = join(TMP, name);
  await ensure(TMP);
  try {
    let img = sharp(src, { failOn: "none" }).rotate();
    const meta = await img.metadata();
    if (meta.width && meta.width > MAX_IMG_W) img = img.resize({ width: MAX_IMG_W, withoutEnlargement: true });
    if (ext === ".png") img = img.png({ compressionLevel: 9, palette: true });
    else if (ext === ".webp") img = img.webp({ quality: WEBP_Q });
    else img = img.jpeg({ quality: JPG_Q, mozjpeg: true });
    await img.toFile(tmp);
  } catch (e) {
    rows.push({ file: name, note: "img failed: " + (e.message || e).slice(0, 50) });
    await copyFile(src, dest); return;
  }
  const o = await sizeOf(src), n = await sizeOf(tmp);
  if (n > 0 && n < o * 0.97) { await copyFile(tmp, dest); totOrig += o; totNew += n;
    rows.push({ file: name, original: (o/1024).toFixed(0)+" KB", compressed: (n/1024).toFixed(0)+" KB", saved: ((1 - n / o) * 100).toFixed(0)+"%" });
  } else { await copyFile(src, dest); totOrig += o; totNew += o;
    rows.push({ file: name, original: (o/1024).toFixed(0)+" KB", compressed: (o/1024).toFixed(0)+" KB", saved: "0% (kept)" });
  }
  await rm(tmp, { force: true });
}

async function main() {
  await ensure(join(ORIG, "documents"));
  await ensure(join(ORIG, "images"));

  console.log("=== PDFs ===");
  for (const f of (await readdir(join(STATIC, "documents"))).filter((f) => f.toLowerCase().endsWith(".pdf")).sort()) {
    process.stdout.write("  " + f + " … ");
    await compressPdf(f);
    const r = rows[rows.length - 1];
    console.log(r.note || `${r.original} -> ${r.compressed} (${r.saved})`);
  }
  // non-pdf documents (e.g. .docx): just preserve original copy, leave served file as-is
  for (const f of (await readdir(join(STATIC, "documents"))).filter((f) => !f.toLowerCase().endsWith(".pdf"))) {
    await pristine("documents", f);
  }

  console.log("=== Images ===");
  for (const f of (await readdir(join(STATIC, "images"))).sort()) {
    if (![".jpg",".jpeg",".png",".webp"].includes(extname(f).toLowerCase())) continue;
    await compressImage(f);
    const r = rows[rows.length - 1];
    console.log(`  ${f}: ${r.note || r.original + " -> " + r.compressed + " (" + r.saved + ")"}`);
  }

  await rm(TMP, { recursive: true, force: true });
  console.log("\n=== TOTAL ===");
  console.log(`Originals preserved in: ${ORIG}`);
  console.log(`Before: ${fmt(totOrig)}   After: ${fmt(totNew)}   Saved: ${fmt(totOrig - totNew)} (${((1 - totNew/totOrig)*100).toFixed(0)}%)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
