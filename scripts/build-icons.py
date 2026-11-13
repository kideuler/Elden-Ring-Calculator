#!/usr/bin/env python3
"""
Fetches the in-game icon of every weapon and talisman in the calculator from Eldenpedia
(eldenring.wiki.gg) and packs them into one sprite sheet:

  data/icons.webp   every icon in a grid of square cells, weapons first, then talismans
  data/icons.json   which cell holds which weapon or talisman, and the wiki file it came from

Each weapon's wiki page is the one named in data/weapons.json; a talisman's page has the
talisman's name. The icon is the image in the page's infobox. The icons are FromSoftware's
artwork, which the wiki hosts for its item pages.

Downloads are kept in a cache folder (by default one in the system temp folder), so a rerun
only fetches icons it doesn't have yet.

Needs Python 3.9+ and Pillow. Run from anywhere:

  python3 -I scripts/build-icons.py [--cache DIR] [--cell 64]
"""
import argparse
import datetime
import json
import math
import re
import ssl
import sys
import tempfile
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
HOST = "eldenring.wiki.gg"
API = f"https://{HOST}/api.php"
USER_AGENT = "EldenRingInfusionCalculator-icons/1.0 (personal fan tool)"
BATCH = 50  # titles per API request, the API's limit
COLUMNS = 32  # cells per sprite row


def tls_context():
    """Certificate checks on, even on a python.org install that hasn't run Install Certificates:
    falls back to certifi, then to the system bundle macOS and most Linux distributions ship."""
    context = ssl.create_default_context()
    if context.get_ca_certs():
        return context
    try:
        import certifi

        context.load_verify_locations(certifi.where())
        return context
    except ImportError:
        pass
    for bundle in ("/etc/ssl/cert.pem", "/etc/ssl/certs/ca-certificates.crt", "/etc/pki/tls/certs/ca-bundle.crt"):
        if Path(bundle).exists():
            context.load_verify_locations(bundle)
            break
    return context


TLS = tls_context()


def fetch(url, attempts=4):
    """GET a URL on the wiki, retrying with backoff. Refuses to leave the wiki's host."""
    if urllib.parse.urlsplit(url).hostname != HOST:
        raise RuntimeError(f"not a {HOST} URL: {url}")
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=60, context=TLS) as response:
                if urllib.parse.urlsplit(response.geturl()).hostname != HOST:
                    raise RuntimeError(f"redirected away from {HOST}: {response.geturl()}")
                return response.read()
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(2 ** attempt)


def api(params):
    data = json.loads(fetch(API + "?" + urllib.parse.urlencode({"format": "json", "formatversion": "2", **params})))
    if "error" in data:
        raise RuntimeError(f"API error: {data['error']}")
    time.sleep(0.5)  # be gentle with the wiki
    return data


def resolve(query, title):
    """Follow the API's title normalization and redirects back to the page it returned."""
    for key in ("normalized", "redirects"):
        for step in query.get(key, []):
            if step["from"] == title:
                title = step["to"]
    return title


def batches(items):
    for i in range(0, len(items), BATCH):
        yield items[i : i + BATCH]


def page_texts(titles):
    """The wikitext of each page, by the title we asked for."""
    texts = {}
    for chunk in batches(titles):
        query = api({"action": "query", "prop": "revisions", "rvprop": "content", "rvslots": "main",
                     "redirects": "1", "titles": "|".join(chunk)})["query"]
        pages = {p["title"]: p for p in query["pages"]}
        for title in chunk:
            page = pages.get(resolve(query, title))
            if page and page.get("revisions"):
                texts[title] = page["revisions"][0]["slots"]["main"]["content"]
    return texts


# The infobox's image parameter, on a line of its own or inline after other parameters
IMAGE_PARAM = re.compile(r"\|\s*image\s*=\s*([^|}\n]*)", re.I)
DISAMBIGUATION = re.compile(r"\{\{\s*disambig|__DISAMBIG__", re.I)
# Where an item's own page is when its name leads to a disambiguation page
OWN_PAGE = {"weapons": "{} (weapon)", "talismans": "{} (talisman)"}


def infobox_image(text):
    """The file name in the infobox's image parameter, without a File: prefix or link markup."""
    match = IMAGE_PARAM.search(text or "")
    if not match:
        return None
    name = match.group(1).replace("[[", "").replace("]]", "")
    name = re.sub(r"^\s*(file|image)\s*:", "", name, flags=re.I).strip()
    return name or None


def image_infos(files, width):
    """URL, size and checksum of each file, with a thumbnail URL at the given width."""
    infos = {}
    for chunk in batches(files):
        query = api({"action": "query", "prop": "imageinfo", "iiprop": "url|size|sha1|mime",
                     "iiurlwidth": str(width), "titles": "|".join("File:" + f for f in chunk)})["query"]
        pages = {p["title"]: p for p in query["pages"]}
        for name in chunk:
            page = pages.get(resolve(query, "File:" + name))
            if page and page.get("imageinfo"):
                # The file's name as the wiki spells it ("talisman_claw_talisman.png" in an
                # infobox is "Talisman claw talisman.png")
                infos[name] = {**page["imageinfo"][0], "file": page["title"].split(":", 1)[1]}
    return infos


def download(info, width, cache):
    """The icon at the requested width (or its original, if smaller), from the cache when there."""
    url = info["thumburl"] if info.get("thumburl") and info.get("width", 0) > width else info["url"]
    suffix = Path(urllib.parse.urlsplit(url).path).suffix.lower() or ".png"
    path = cache / f"{info['sha1']}-{width}{suffix}"
    if not path.exists():
        data = fetch(url)
        time.sleep(0.15)
        partial = path.with_name(path.name + ".part")
        partial.write_bytes(data)
        partial.replace(path)
    return path


def cell_image(path, cell):
    """The icon scaled to fit a cell, centered on a transparent background."""
    with Image.open(path) as source:
        # Scale with premultiplied alpha so transparent edges don't bleed dark fringes
        icon = source.convert("RGBA").convert("RGBa")
    scale = cell / max(icon.size)
    size = (max(1, round(icon.width * scale)), max(1, round(icon.height * scale)))
    icon = icon.resize(size, Image.LANCZOS).convert("RGBA")
    tile = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
    tile.paste(icon, ((cell - size[0]) // 2, (cell - size[1]) // 2))
    return tile


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "er-calculator-icons",
                        help="folder for downloaded icons (default: %(default)s)")
    parser.add_argument("--cell", type=int, default=64, help="sprite cell size in pixels, a multiple of 16 (default: 64)")
    parser.add_argument("--quality", type=int, default=72, help="WebP quality (default: 72)")
    args = parser.parse_args()
    if args.cell % 16:
        sys.exit("--cell must be a multiple of 16, so lossy compression never mixes neighboring icons")
    args.cache.mkdir(parents=True, exist_ok=True)
    width = args.cell * 2  # download at twice the cell size, then scale down here

    weapons = json.loads((ROOT / "data/weapons.json").read_text("utf8"))["weapons"]
    talismans = json.loads((ROOT / "data/talismans.json").read_text("utf8"))["talismans"]
    items = [("weapons", w["name"], urllib.parse.unquote(w["wiki"].split("/wiki/", 1)[1]).replace("_", " "))
             for w in weapons]
    items += [("talismans", t["name"], t["name"]) for t in talismans]

    titles = sorted({title for _, _, title in items})
    print(f"Reading {len(titles)} wiki pages…", file=sys.stderr)
    texts = page_texts(titles)
    # A name shared with something else (Beast Claw: a weapon, its class and an incantation)
    # leads to a disambiguation page, so read the item's own page instead
    own_pages = {title: OWN_PAGE[kind].format(title) for kind, _, title in items
                 if DISAMBIGUATION.search(texts.get(title, ""))}
    if own_pages:
        own_texts = page_texts(sorted(set(own_pages.values())))
        for title, own in own_pages.items():
            if own in own_texts:
                texts[title] = own_texts[own]
    files = {title: infobox_image(texts.get(title)) for title in titles}
    print(f"Looking up {len(set(filter(None, files.values())))} icon files…", file=sys.stderr)
    infos = image_infos(sorted(set(filter(None, files.values()))), width)

    out = {"weapons": {}, "talismans": {}}
    sources = {}
    missing = []
    tiles = []
    for kind, name, title in items:
        file = files.get(title)
        info = infos.get(file) if file else None
        if not info:
            missing.append({"kind": kind, "name": name, "page": title,
                            "reason": "no page" if title not in texts else "no infobox image" if not file else "file not found"})
            continue
        path = download(info, width, args.cache)
        out[kind][name] = len(tiles)
        sources[name] = info["file"]
        tiles.append(cell_image(path, args.cell))
        if len(tiles) % 50 == 0:
            print(f"  {len(tiles)} icons", file=sys.stderr)

    rows = math.ceil(len(tiles) / COLUMNS)
    sheet = Image.new("RGBA", (COLUMNS * args.cell, rows * args.cell), (0, 0, 0, 0))
    for i, tile in enumerate(tiles):
        sheet.paste(tile, ((i % COLUMNS) * args.cell, (i // COLUMNS) * args.cell))
    sheet.save(ROOT / "data/icons.webp", "WEBP", quality=args.quality, alpha_quality=80, method=6)

    index = {
        "meta": {
            "title": "Weapon and talisman icons for the calculator",
            "source": f"https://{HOST} (Eldenpedia): the image in each item page's infobox",
            "copyright": "Item icons are FromSoftware's artwork (Elden Ring, © Bandai Namco Entertainment / FromSoftware).",
            "retrieved": datetime.date.today().isoformat(),
            "cell": args.cell,
            "columns": COLUMNS,
            "rows": rows,
            "fields": {
                "weapons": "Weapon name to its cell in icons.webp, counted left to right, top to bottom from 0.",
                "talismans": "Talisman name to its cell.",
                "files": "The wiki file each icon came from.",
                "missing": "Items the wiki had no icon for; the page shows them without one.",
            },
        },
        **out,
        "files": sources,
        "missing": missing,
    }
    (ROOT / "data/icons.json").write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", "utf8")
    size = (ROOT / "data/icons.webp").stat().st_size
    print(f"Wrote data/icons.webp ({sheet.width}×{sheet.height}, {size / 1024:.0f} KB) and data/icons.json: "
          f"{len(out['weapons'])} weapons, {len(out['talismans'])} talismans, {len(missing)} missing", file=sys.stderr)
    for m in missing:
        print(f"  missing {m['kind'][:-1]} {m['name']} ({m['reason']}, page {m['page']})", file=sys.stderr)


if __name__ == "__main__":
    main()
