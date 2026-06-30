#!/usr/bin/env node
/*
 * Content extractor: mirrored Squarespace HTML -> clean Hugo Markdown.
 *
 * Reads the offline mirror in ../../compplan2045-archive/docs, pulls the
 * meaningful content out of each page (headings, text, lists, links, buttons,
 * images, video embeds), rewrites links to clean Hugo paths, copies referenced
 * images/documents into ../static, and writes ../content/<slug>.md.
 *
 * This only *seeds* the content — the Markdown is meant to be hand-edited after.
 */
import { readFile, writeFile, mkdir, copyFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import * as cheerio from "cheerio";
import TurndownService from "turndown";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HUGO = join(__dirname, "..");
const ARCHIVE = join(HUGO, "..", "compplan2045-archive", "docs");
const CONTENT = join(HUGO, "content");
const IMG_DIR = join(HUGO, "static", "images");
const DOC_DIR = join(HUGO, "static", "documents");

// page slug -> { out: relative md path, menu?: {name, weight} }
const PAGES = {
  "index.html":      { out: "_index.md" },
  "about.html":      { out: "about.md",       menu: { name: "About", weight: 10 } },
  "draftplans.html": { out: "draftplans.md",  menu: { name: "View the Plans", weight: 20 } },
  "final-oh.html":   { out: "final-oh.md",    menu: { name: "Final Open House", weight: 30 } },
  "news.html":       { out: "news/_index.md", menu: { name: "News", weight: 40 } },
  "engage.html":     { out: "engage.md",      menu: { name: "Engage", weight: 50 } },
  "planaustin.html": { out: "planaustin.md" },
  "planmc.html":     { out: "planmc.md" },
  "austin-pac.html": { out: "austin-pac.md" },
  "mc-pac.html":     { out: "mc-pac.md" },
  "open-house.html": { out: "open-house.md" },
};

// internal page path (no ext) -> hugo url
const INTERNAL = {
  "/": "/", "/index": "/",
  "/about": "/about/", "/draftplans": "/draftplans/", "/final-oh": "/final-oh/",
  "/news": "/news/", "/engage": "/engage/", "/planaustin": "/planaustin/",
  "/planmc": "/planmc/", "/austin-pac": "/austin-pac/", "/mc-pac": "/mc-pac/",
  "/open-house": "/open-house/",
};

const td = new TurndownService({ headingStyle: "atx", bulletListMarker: "-", codeBlockStyle: "fenced" });
// keep simple links; drop spans/styles
td.addRule("stripspan", { filter: ["span"], replacement: (c) => c });

const copies = new Map(); // srcAbs -> destAbs (dedupe)
function sanitize(name) {
  return decodeURIComponent(name)
    .replace(/^[A-Za-z0-9_-]{20,}__/, "")     // drop google-drive id prefix
    .replace(/__format=[^.]*/g, "")          // drop squarespace size suffix
    .replace(/[+]/g, "-")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-").replace(/^-|-$/g, "");
}

/** Resolve an archive-relative href to a clean Hugo URL, queuing asset copies. */
function rewrite(href) {
  if (!href) return href;
  let h = href.trim();
  if (/^(mailto:|tel:|#|https?:\/\/(?!www\.compplan2045\.com))/i.test(h)) return h; // external/mail/anchor
  h = h.replace(/^https?:\/\/www\.compplan2045\.com/i, "");
  h = h.replace(/^\.\//, "/").replace(/^(?!\/)/, "/");

  // documents (pdf/doc/etc) under _files or _assets/.../s/
  const docMatch = h.match(/\/(?:_files\/[^?#]*?|_assets\/[^?#]*?)\/([^/?#]+\.(?:pdf|docx?|xlsx?|pptx?|csv|zip))/i);
  if (docMatch) {
    const srcRel = h.split(/[?#]/)[0].replace(/^\//, "");
    const src = join(ARCHIVE, srcRel);
    const dest = sanitize(basename(srcRel));
    if (existsSync(src)) copies.set(src, join(DOC_DIR, dest));
    return "/documents/" + dest;
  }
  // images under _assets
  const imgMatch = h.match(/\/_assets\/[^?#]*\.(png|jpe?g|gif|svg|webp|avif|ico)(?:[?#]|$)/i);
  if (imgMatch) {
    const srcRel = h.split(/[?#]/)[0].replace(/^\//, "");
    const src = join(ARCHIVE, srcRel);
    const dest = sanitize(basename(srcRel));
    if (existsSync(src)) copies.set(src, join(IMG_DIR, dest));
    return "/images/" + dest;
  }
  // internal pages
  const noExt = h.replace(/\.html$/, "").replace(/\/$/, "") || "/";
  if (INTERNAL[noExt]) return INTERNAL[noExt];
  return h;
}

function imgSrc($el) {
  const $ = $el;
  return $.attr("data-src") || $.attr("src") || ($.attr("srcset") || "").split(",")[0].trim().split(/\s+/)[0];
}

function blockToMd($, el) {
  const $el = $(el);
  const cls = $el.attr("class") || "";

  if (cls.includes("sqs-block-html")) {
    const html = $el.find(".sqs-html-content").html();
    if (!html) return "";
    // rewrite anchors inside html
    const $$ = cheerio.load(html, null, false);
    $$("a[href]").each((_, a) => $$(a).attr("href", rewrite($$(a).attr("href"))));
    $$("img").each((_, im) => $$(im).attr("src", rewrite(imgSrc($$(im)))));
    let md = td.turndown($$.html()).trim();
    return md;
  }
  if (cls.includes("sqs-block-button")) {
    const a = $el.find("a.sqs-block-button-element").first();
    const text = a.text().trim();
    const href = rewrite(a.attr("href"));
    if (!text || !href) return "";
    return `{{< button href="${href}" >}}${text}{{< /button >}}`;
  }
  if (cls.includes("sqs-block-image")) {
    const img = $el.find("img").first();
    const src = rewrite(imgSrc(img));
    const alt = (img.attr("alt") || "").trim();
    const link = $el.find("a").first().attr("href");
    if (!src) return "";
    const md = `![${alt}](${src})`;
    return link ? `[${md}](${rewrite(link)})` : md;
  }
  if (cls.includes("sqs-block-video") || cls.includes("sqs-block-embed")) {
    const iframe = $el.find("iframe").first();
    const url = iframe.attr("src") || iframe.attr("data-src") || $el.find("a").first().attr("href") || "";
    const yt = url.match(/(?:youtube\.com\/embed\/|youtu\.be\/|v=)([\w-]{6,})/);
    if (yt) return `{{< youtube ${yt[1]} >}}`;
    if (url) return `{{< video src="${url}" >}}`;
    return "";
  }
  return "";
}

async function extractPage(file, cfg) {
  const html = await readFile(join(ARCHIVE, file), "utf8");
  const $ = cheerio.load(html);
  const title = ($('meta[property="og:title"]').attr("content") || $("title").text() || file)
    .replace(/\s*[—|].*$/, "").trim();

  const parts = [];
  const seen = new Set();
  $("#page .sqs-block, main .sqs-block, [data-content-field='main-content'] .sqs-block").each((_, el) => {
    if ($(el).parents(".sqs-block").length) return;   // top-level blocks only
    if (seen.has(el)) return; seen.add(el);
    const md = blockToMd($, el);
    if (md && md.replace(/[\s ]+/g, "")) parts.push(md);
  });

  const fm = [
    "---",
    `title: ${JSON.stringify(title)}`,
  ];
  if (cfg.menu) fm.push(`menu:\n  main:\n    name: ${JSON.stringify(cfg.menu.name)}\n    weight: ${cfg.menu.weight}`);
  fm.push("---", "");
  const body = parts.join("\n\n") + "\n";

  const outPath = join(CONTENT, cfg.out);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, fm.join("\n") + body, "utf8");
  return { file, out: cfg.out, blocks: parts.length, title };
}

async function main() {
  await mkdir(IMG_DIR, { recursive: true });
  await mkdir(DOC_DIR, { recursive: true });
  const results = [];
  for (const [file, cfg] of Object.entries(PAGES)) {
    if (!existsSync(join(ARCHIVE, file))) { console.warn("missing", file); continue; }
    results.push(await extractPage(file, cfg));
  }
  // perform queued asset copies
  let copied = 0;
  for (const [src, dest] of copies) {
    await mkdir(dirname(dest), { recursive: true });
    await copyFile(src, dest); copied++;
  }
  console.table(results);
  console.log(`Copied ${copied} assets (${[...copies.values()].filter(d => d.includes("documents")).length} docs, ${[...copies.values()].filter(d => d.includes("images")).length} images).`);
}
main().catch((e) => { console.error(e); process.exit(1); });
