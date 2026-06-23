#!/usr/bin/env python3
"""Unpacks wishlist_bundle.json into the repo. Run from repo root: python apply_wishlist.py"""
import json, os

b = json.load(open("wishlist_bundle.json", encoding="utf-8"))

# 1. write the two new backend route files
for path, content in b["new_files"].items():
    os.makedirs(os.path.dirname(path), exist_ok=True)
    open(path, "w", encoding="utf-8").write(content)
    print(f"  wrote {path}")

# 2. append JS (skip if already present)
jsf = "extensions/rewards-widget/assets/rewards-widget.js"
js = open(jsf, encoding="utf-8").read()
if "DROPY WISHLIST" in js:
    print("  JS already has wishlist — skipped")
else:
    open(jsf, "a", encoding="utf-8").write("\n\n" + b["js_append"])
    print(f"  appended wishlist JS to {jsf}")

# 3. append CSS (skip if already present)
cssf = "extensions/rewards-widget/assets/rewards-widget.css"
css = open(cssf, encoding="utf-8").read()
if "Dropy Wishlist" in css:
    print("  CSS already has wishlist — skipped")
else:
    open(cssf, "a", encoding="utf-8").write("\n\n" + b["css_append"])
    print(f"  appended wishlist CSS to {cssf}")

# validate braces
css = open(cssf, encoding="utf-8").read()
print("  CSS braces balanced:", css.count("{") == css.count("}"))
print("DONE. Now run: node -c " + jsf + "  then deploy.")
