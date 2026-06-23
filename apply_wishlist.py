#!/usr/bin/env python3
"""Applies/updates the wishlist feature. Run from repo root: python apply_wishlist.py
Safe to re-run — it REPLACES existing wishlist blocks rather than duplicating."""
import json, os

b = json.load(open("wishlist_bundle.json", encoding="utf-8"))

# 1. backend route files (overwrite)
for path, content in b["new_files"].items():
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8").write(content)
    print(f"  wrote {path}")

# 2. JS — replace existing wishlist block or append
jsf = "extensions/rewards-widget/assets/rewards-widget.js"
js = open(jsf, encoding="utf-8").read()
marker = "/* ═══════════════════════════════════════════════════════════\n   DROPY WISHLIST"
idx = js.find(marker)
if idx != -1:
    js = js[:idx].rstrip() + "\n"
    print("  removed old wishlist JS block")
open(jsf, "w", encoding="utf-8").write(js.rstrip() + "\n\n" + b["js_append"].rstrip() + "\n")
print(f"  applied wishlist JS to {jsf}")

# 3. CSS — replace existing wishlist block or append
cssf = "extensions/rewards-widget/assets/rewards-widget.css"
css = open(cssf, encoding="utf-8").read()
cmark = "/* ═══════════ Dropy Wishlist ═══════════ */"
cidx = css.find(cmark)
if cidx != -1:
    css = css[:cidx].rstrip() + "\n"
    print("  removed old wishlist CSS block")
open(cssf, "w", encoding="utf-8").write(css.rstrip() + "\n\n" + b["css_append"].rstrip() + "\n")
print(f"  applied wishlist CSS to {cssf}")

css = open(cssf, encoding="utf-8").read()
print("  CSS braces balanced:", css.count("{") == css.count("}"))
print("DONE. Run: node -c " + jsf + "   then deploy.")
