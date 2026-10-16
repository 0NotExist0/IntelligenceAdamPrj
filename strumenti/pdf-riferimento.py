#!/usr/bin/env python3
"""Localizza un riferimento spaziale in un PDF e crea un ritaglio annotato."""
import argparse, json, re, sys
from pathlib import Path
import pymupdf as fitz

def norm(value):
    return re.sub(r"\s+", " ", str(value or "")).strip().casefold()

def main():
    p = argparse.ArgumentParser()
    p.add_argument("input")
    p.add_argument("hint")
    p.add_argument("output")
    args = p.parse_args()
    source, output = Path(args.input).resolve(), Path(args.output).resolve()
    doc = fitz.open(str(source))
    hint_words = re.findall(r"[\wÀ-ÿ.()+/-]+", args.hint, re.UNICODE)[:12]
    match = None
    for page_index, page in enumerate(doc):
        for count in range(len(hint_words), 0, -1):
            candidate = " ".join(hint_words[:count]).strip(" .,:;-")
            if len(candidate) < 3:
                continue
            rects = page.search_for(candidate)
            if rects:
                match = (page_index, page, candidate, rects[0])
                break
        if match:
            break
    if not match:
        raise RuntimeError("riferimento non trovato nel PDF: " + args.hint[:120])

    page_index, page, candidate, anchor = match
    clip = fitz.Rect(max(0, anchor.x0 - 90), max(0, anchor.y0 - 95),
                     min(page.rect.width, anchor.x1 + 260), min(page.rect.height, anchor.y1 + 190))
    # Evidenzia l'ancora in rosso e la fascia geometricamente sottostante in blu.
    page.draw_rect(anchor, color=(0.9, 0.1, 0.1), width=2, overlay=True)
    # Include anche testi che iniziano sulla stessa baseline ma hanno il centro piu'
    # in basso: e' il caso reale della riga sovrapposta sotto "DigComp 2.0".
    below = fitz.Rect(clip.x0, anchor.y0 + 2, clip.x1, clip.y1)
    page.draw_rect(below, color=(0.1, 0.35, 0.9), width=1.5, dashes="4 3", overlay=True)
    page.insert_text((clip.x0 + 4, max(clip.y0 + 12, anchor.y0 - 6)), "ANCORA", fontsize=8,
                     color=(0.9, 0.1, 0.1), overlay=True)
    output.parent.mkdir(parents=True, exist_ok=True)
    page.get_pixmap(matrix=fitz.Matrix(2.2, 2.2), clip=clip, alpha=False).save(str(output))

    nearby = []
    for block in page.get_text("blocks"):
        rect = fitz.Rect(block[:4])
        text = re.sub(r"\s+", " ", block[4]).strip()
        if text and rect.intersects(clip):
            relation = "sotto" if rect.y0 >= anchor.y1 - 1 or rect.y0 > anchor.y0 + anchor.height * 0.55 else ("sopra" if rect.y1 <= anchor.y0 + 1 else "stessa fascia")
            nearby.append({"text": text[:500], "relation": relation,
                           "bbox": [round(v, 1) for v in rect]})
    print(json.dumps({"ok": True, "pdf": str(source), "page": page_index + 1,
                      "anchor": candidate, "anchor_bbox": [round(v, 1) for v in anchor],
                      "crop": str(output), "nearby": nearby}, ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        sys.exit(1)
