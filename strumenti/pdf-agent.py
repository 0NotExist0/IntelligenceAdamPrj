#!/usr/bin/env python3
"""Motore PDF locale e APDF opzionale per NotExist Intelligience Studio."""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def find_tool(name):
    found = shutil.which(name)
    if found:
        return found
    patterns = {
        "qpdf": [r"C:\Program Files\qpdf*\bin\qpdf.exe"],
        "pdftk": [r"C:\Program Files (x86)\PDFtk Server\bin\pdftk.exe",
                  r"C:\Program Files\PDFtk Server\bin\pdftk.exe"],
    }
    import glob
    for pattern in patterns.get(name, []):
        matches = glob.glob(pattern)
        if matches:
            return matches[-1]
    return None


def emit(data, code=0):
    print(json.dumps(data, ensure_ascii=False, indent=2))
    raise SystemExit(code)


def require_file(raw):
    path = Path(raw).expanduser().resolve()
    if not path.is_file():
        raise FileNotFoundError(f"File non trovato: {path}")
    return path


def output_path(raw):
    path = Path(raw).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    return path


def capabilities():
    import importlib.util
    return {
        "pymupdf": bool(importlib.util.find_spec("pymupdf")) or bool(importlib.util.find_spec("fitz")),
        "pypdf": bool(importlib.util.find_spec("pypdf")),
        "requests": bool(importlib.util.find_spec("requests")),
        "qpdf": find_tool("qpdf"),
        "pdftk": find_tool("pdftk") or shutil.which("pdftk-java"),
        "apdf": bool(os.environ.get("APDF_API_TOKEN")),
        "apdf_base_url": os.environ.get("APDF_BASE_URL", "https://apdf.io/api"),
    }


def verify_pdf(path, render_dir=None):
    import pymupdf as fitz
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    doc = fitz.open(str(path))
    if len(reader.pages) != doc.page_count or doc.page_count < 1:
        raise RuntimeError("PDF non valido o conteggio pagine incoerente")
    rendered = []
    if render_dir:
        folder = output_path(render_dir)
        folder.mkdir(parents=True, exist_ok=True)
        for index, page in enumerate(doc):
            target = folder / f"pagina-{index + 1:03d}.png"
            page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).save(str(target))
            rendered.append(str(target))
    result = {
        "ok": True,
        "file": str(path),
        "pages": doc.page_count,
        "bytes": path.stat().st_size,
        "encrypted": bool(reader.is_encrypted),
        "rendered": rendered,
    }
    doc.close()
    return result


def inspect_pdf(args):
    import pymupdf as fitz
    from pypdf import PdfReader

    path = require_file(args.input)
    reader = PdfReader(str(path))
    doc = fitz.open(str(path))
    fields = reader.get_fields() or {}
    result = {
        "ok": True,
        "file": str(path),
        "pages": doc.page_count,
        "bytes": path.stat().st_size,
        "metadata": {k: str(v) for k, v in (reader.metadata or {}).items()},
        "form_fields": sorted(fields.keys()),
        "encrypted": bool(reader.is_encrypted),
    }
    doc.close()
    return result


def extract_text(args):
    import pymupdf as fitz

    path = require_file(args.input)
    doc = fitz.open(str(path))
    pages = [{"page": i + 1, "text": page.get_text("text")} for i, page in enumerate(doc)]
    doc.close()
    return {"ok": True, "file": str(path), "pages": pages}


def merge_pdf(args):
    from pypdf import PdfReader, PdfWriter

    output = output_path(args.output)
    writer = PdfWriter()
    for raw in args.inputs:
        writer.append(PdfReader(str(require_file(raw))))
    with output.open("wb") as stream:
        writer.write(stream)
    return verify_pdf(output, args.render_dir)


def split_pdf(args):
    from pypdf import PdfReader, PdfWriter

    source = require_file(args.input)
    folder = output_path(args.output_dir)
    folder.mkdir(parents=True, exist_ok=True)
    reader = PdfReader(str(source))
    files = []
    for index, page in enumerate(reader.pages):
        writer = PdfWriter()
        writer.add_page(page)
        target = folder / f"{source.stem}-pagina-{index + 1:03d}.pdf"
        with target.open("wb") as stream:
            writer.write(stream)
        verify_pdf(target)
        files.append(str(target))
    return {"ok": True, "pages": len(files), "files": files}


def rotate_pdf(args):
    from pypdf import PdfReader, PdfWriter

    source = require_file(args.input)
    output = output_path(args.output)
    reader = PdfReader(str(source))
    writer = PdfWriter()
    selected = None if not args.pages else {int(v) - 1 for v in args.pages.split(",")}
    for index, page in enumerate(reader.pages):
        if selected is None or index in selected:
            page.rotate(args.degrees)
        writer.add_page(page)
    with output.open("wb") as stream:
        writer.write(stream)
    return verify_pdf(output, args.render_dir)


def annotate_pdf(args):
    import pymupdf as fitz

    source = require_file(args.input)
    output = output_path(args.output)
    doc = fitz.open(str(source))
    page = doc[args.page - 1]
    rect = fitz.Rect(args.x, args.y, args.x + args.width, args.y + args.height)
    annot = page.add_freetext_annot(rect, args.text, fontsize=args.font_size)
    annot.set_colors(stroke=(0.12, 0.35, 0.65), fill=(0.94, 0.97, 1.0))
    annot.update()
    doc.save(str(output), garbage=4, deflate=True)
    doc.close()
    return verify_pdf(output, args.render_dir)


def encrypt_pdf(args):
    from pypdf import PdfReader, PdfWriter

    source = require_file(args.input)
    output = output_path(args.output)
    writer = PdfWriter(clone_from=PdfReader(str(source)))
    writer.encrypt(args.password, args.owner_password or args.password, algorithm="AES-256")
    with output.open("wb") as stream:
        writer.write(stream)
    return {"ok": True, "file": str(output), "pages": len(writer.pages), "encrypted": True}


def fill_form_json(args):
    from pypdf import PdfReader, PdfWriter
    from pypdf.generic import NameObject

    source = require_file(args.input)
    output = output_path(args.output)
    value_arg = str(args.values).strip()
    value_file = None if value_arg.startswith("{") else Path(value_arg)
    raw_values = value_file.read_text(encoding="utf-8") if value_file and value_file.is_file() else value_arg
    values = json.loads(raw_values)
    if not isinstance(values, dict) or not values:
        raise ValueError("I valori del modulo devono essere un oggetto JSON non vuoto")
    reader = PdfReader(str(source))
    writer = PdfWriter()
    writer.clone_document_from_reader(reader)
    fields = writer.get_fields() or {}
    missing = set(values) - set(fields)
    if missing:
        writer.reattach_fields()
        fields = writer.get_fields() or {}
        missing = set(values) - set(fields)
    if missing:
        raise ValueError("Campi non trovati: " + ", ".join(sorted(missing)))
    values_to_write = dict(values)
    if args.flatten:
        values_to_write = {
            name: field.get("/V", "/Off" if field.get("/FT") == "/Btn" else "")
            for name, field in fields.items()
        }
        values_to_write.update(values)
    writer.update_page_form_field_values(None, values_to_write, auto_regenerate=False, flatten=args.flatten)
    if args.flatten:
        writer.remove_annotations(subtypes="/Widget")
        writer.root_object.pop(NameObject("/AcroForm"), None)
    with output.open("wb") as stream:
        writer.write(stream)

    check = PdfReader(str(output))
    if args.flatten:
        widgets = sum(1 for page in check.pages for annot in (page.get("/Annots") or [])
                      if annot.get_object().get("/Subtype") == "/Widget")
        if widgets or check.get_fields():
            raise RuntimeError("Il modulo appiattito contiene ancora campi o widget")
    else:
        written = check.get_fields() or {}
        for name, expected in values.items():
            actual = written.get(name, {}).get("/V")
            if str(actual) != str(expected):
                raise RuntimeError(f"Valore non verificato per {name}: {actual!r}")
    result = verify_pdf(output, args.render_dir)
    result["form_fields_updated"] = sorted(values.keys())
    result["flattened"] = bool(args.flatten)
    return result


def qpdf_action(args):
    executable = find_tool("qpdf")
    if not executable:
        raise RuntimeError("qpdf non installato o non presente nel PATH")
    source = require_file(args.input)
    if args.qpdf_command == "check":
        cmd = [executable, "--check", str(source)]
        output = None
    else:
        if not args.output:
            raise ValueError("Il file di output e obbligatorio per repair e linearize")
        output = output_path(args.output)
        option = "--linearize" if args.qpdf_command == "linearize" else "--object-streams=generate"
        cmd = [executable, option, str(source), str(output)]
    done = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    result = {"ok": done.returncode in (0, 3), "code": done.returncode,
              "stdout": done.stdout[-4000:], "stderr": done.stderr[-4000:]}
    if output and done.returncode == 0:
        result["verification"] = verify_pdf(output, args.render_dir)
    return result


def pdftk_fill(args):
    executable = find_tool("pdftk") or shutil.which("pdftk-java")
    if not executable:
        raise RuntimeError("pdftk-java non installato o non presente nel PATH")
    source = require_file(args.input)
    data = require_file(args.data)
    output = output_path(args.output)
    cmd = [executable, str(source), "fill_form", str(data), "output", str(output)]
    if args.flatten:
        cmd.append("flatten")
    done = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
    if done.returncode != 0:
        raise RuntimeError(done.stderr[-2000:] or "pdftk-java ha restituito un errore")
    return verify_pdf(output, args.render_dir)


def apdf_request(args):
    import requests

    token = os.environ.get("APDF_API_TOKEN")
    if not token:
        raise RuntimeError("APDF_API_TOKEN non configurato")
    endpoint = args.endpoint.strip().lstrip("/")
    allowed = ("pdf/", "docs", "automations", "job/")
    if not endpoint.startswith(allowed):
        raise ValueError("Endpoint APDF non consentito")
    payload = json.loads(args.data or "{}")
    base = os.environ.get("APDF_BASE_URL", "https://apdf.io/api").rstrip("/")
    response = requests.request(args.method, f"{base}/{endpoint}", data=payload,
                                headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
                                timeout=(10, 60))
    try:
        body = response.json()
    except ValueError:
        body = {"text": response.text[:4000]}
    return {"ok": response.ok, "status": response.status_code, "data": body}


def parser():
    root = argparse.ArgumentParser(description="Motore PDF ibrido dello Studio")
    sub = root.add_subparsers(dest="command", required=True)
    sub.add_parser("capabilities")
    for name in ("inspect", "text"):
        p = sub.add_parser(name)
        p.add_argument("input")
    p = sub.add_parser("merge")
    p.add_argument("output")
    p.add_argument("inputs", nargs="+")
    p.add_argument("--render-dir")
    p = sub.add_parser("split")
    p.add_argument("input")
    p.add_argument("output_dir")
    p = sub.add_parser("rotate")
    p.add_argument("input")
    p.add_argument("output")
    p.add_argument("--degrees", type=int, choices=(90, 180, 270), default=90)
    p.add_argument("--pages", help="Pagine 1-based separate da virgola")
    p.add_argument("--render-dir")
    p = sub.add_parser("annotate")
    p.add_argument("input")
    p.add_argument("output")
    p.add_argument("text")
    p.add_argument("--page", type=int, default=1)
    p.add_argument("--x", type=float, default=36)
    p.add_argument("--y", type=float, default=36)
    p.add_argument("--width", type=float, default=240)
    p.add_argument("--height", type=float, default=60)
    p.add_argument("--font-size", type=float, default=11)
    p.add_argument("--render-dir")
    p = sub.add_parser("encrypt")
    p.add_argument("input")
    p.add_argument("output")
    p.add_argument("password")
    p.add_argument("--owner-password")
    p = sub.add_parser("qpdf")
    p.add_argument("qpdf_command", choices=("check", "repair", "linearize"))
    p.add_argument("input")
    p.add_argument("output", nargs="?")
    p.add_argument("--render-dir")
    p = sub.add_parser("fill-form")
    p.add_argument("input")
    p.add_argument("data")
    p.add_argument("output")
    p.add_argument("--flatten", action="store_true")
    p.add_argument("--render-dir")
    p = sub.add_parser("fill-form-json")
    p.add_argument("input")
    p.add_argument("values", help="Oggetto JSON o percorso di un file JSON")
    p.add_argument("output")
    p.add_argument("--flatten", action="store_true")
    p.add_argument("--render-dir")
    p = sub.add_parser("apdf")
    p.add_argument("endpoint")
    p.add_argument("--method", choices=("GET", "POST", "DELETE"), default="POST")
    p.add_argument("--data", default="{}", help="Oggetto JSON")
    return root


def main():
    args = parser().parse_args()
    actions = {
        "capabilities": lambda _: capabilities(), "inspect": inspect_pdf, "text": extract_text,
        "merge": merge_pdf, "split": split_pdf, "rotate": rotate_pdf, "annotate": annotate_pdf,
        "encrypt": encrypt_pdf, "fill-form-json": fill_form_json, "qpdf": qpdf_action,
        "fill-form": pdftk_fill, "apdf": apdf_request,
    }
    try:
        emit(actions[args.command](args))
    except Exception as exc:
        emit({"ok": False, "error": str(exc), "type": type(exc).__name__}, 1)


if __name__ == "__main__":
    main()
