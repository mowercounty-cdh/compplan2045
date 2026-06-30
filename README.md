# Comprehensive Plan 2045 — Hugo site

A clean, maintainable [Hugo](https://gohugo.io) rebuild of the Mower County /
City of Austin 2045 Comprehensive Plan website. Content lives in Markdown and is
easy to edit; the site auto-deploys to GitHub Pages on every push.

**Live site:** https://mowercounty-cdh.github.io/compplan2045/

## Editing content

Every page is a Markdown file under [`content/`](content/):

| File | Page |
|------|------|
| `content/_index.md` | Home (hero text is in the front matter) |
| `content/about.md` | About |
| `content/draftplans.md` | View the Plans |
| `content/final-oh.md` | Final Open House |
| `content/news/_index.md` | News |
| `content/engage.md` | Engage |
| `content/planaustin.md`, `planmc.md` | Plan detail pages |
| `content/austin-pac.md`, `mc-pac.md`, `open-house.md` | Secondary pages |

Edit the Markdown (in GitHub's web editor or locally), commit, and the site
rebuilds automatically. Front-matter `menu.main` controls the top nav (name +
weight = order).

**Buttons:** `{{</* button href="/documents/x.pdf" */>}}Label{{</* /button */>}}`
**Videos:** `{{</* youtube VIDEO_ID */>}}` or `{{</* video src="URL" */>}}`

Documents (PDFs) live in `static/documents/`; images in `static/images/`. Drop a
file there and link it as `/documents/filename.pdf` — the theme adds the correct
base path automatically via render hooks.

## Local preview

Install Hugo (extended): `winget install Hugo.Hugo.Extended`, then:

```bash
hugo server
# open the printed http://localhost:1313/compplan2045/ URL
```

## Deployment

Pushing to `main` triggers [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml),
which builds with Hugo and publishes to GitHub Pages. No manual build step needed.

## How the content was seeded

`tools/extract.mjs` parsed the original site mirror (the `compplan2045-archive`
repo) into the Markdown here — pulling text, links, buttons, images, and the
Google Drive / hosted PDFs, and rewriting every link to a local path. It's kept
for reference; you don't need to run it again to edit the site.

## Optimized assets & originals

The PDFs and images served from `static/` are **compressed** versions (≈44% smaller
overall — 338 MB → 188 MB). The full-resolution **originals are preserved in
[`originals/`](originals/)** (documents + images), which is *not* published to the live
site — Hugo only serves `static/`. The live links automatically point to the compressed
copies because they share the same filenames.

To re-run compression after adding new files to `static/`:

```bash
cd tools && node compress.mjs
```

This needs **Ghostscript** (PDFs, `/ebook` ~150 dpi, text preserved) and the `sharp`
npm package (images). It compresses from the pristine `originals/`, so it's safe to
re-run. A compressed file is kept only when it's actually smaller; page counts are
unchanged. (Full-resolution originals also live in the `compplan2045-archive` repo.)

## Structure

```
content/            Markdown pages (edit these)
layouts/            Custom theme (templates, partials, shortcodes, render hooks)
assets/css/main.css Brand styles
static/             Logo, favicon, images, documents  (compressed, served)
originals/          Full-resolution originals (preserved, NOT published)
tools/              extract.mjs (content seeding) + compress.mjs (asset optimization)
hugo.toml           Site config + main menu
```
