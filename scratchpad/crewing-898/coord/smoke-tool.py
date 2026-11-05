#!/usr/bin/env python3
"""Instrument for the No.898 part-A smoke: capture frames off Xephyr, measure the refusal
line, and read the expected texts OUT OF the shipped dist.

WHY THIS EXISTS AS A SEPARATE FILE: the shell driver owns the gates and the irreversible
actions; this owns the measurements. Keeping them apart means the driver can be read for
"what does it do to the machine" without wading through pixel arithmetic.

THREE RULES IT ENFORCES, each learned the hard way earlier in this task:

1. A TEXT IS NEVER TRANSCRIBED FROM A PICTURE. `text` reads the four strings out of
   dist/index.html by key, after checking the file's sha256 against the pin. A frame shows
   WHETHER a line rendered; only the dist says WHAT the line says. (Same discipline as
   smoke-3d, whose README records it.)

2. EVERY ZERO GETS A POSITIVE CONTROL. `capture` refuses a frame with fewer than
   MIN_DISTINCT_COLOURS distinct colours, because a black rectangle is what a broken capture
   path produces and it would otherwise pass as "the app showed nothing".

3. GEOMETRY DISCRIMINATES, OCR IS NOT AVAILABLE AND NOT GUESSED AT. tesseract is absent on
   this machine. So `analyze` does not claim to read the line; it measures the refusal box's
   extent and the rendered contrast. Which of the four texts is on screen is settled by the
   CALIBRATION against smoke-3d: the two second-step texts are longer by construction (they
   prepend "Account accepted, but ..."), so a first-step line must occupy FEWER rows. A claim
   that a frame shows S1 rests on that comparison plus the network condition, never on the
   picture alone.

CONTRAST, AND THE DIRECTION OF ITS ERROR: antialiasing pulls glyph cores TOWARD the
background, so a frame UNDERSTATES contrast for dark-on-light text and OVERSTATES it for
light-on-dark. smoke-3d measured 6.09/5.94 against a declared 6.40 - understated, as
expected for dark text. A rendered figure BELOW the declared one is therefore normal here;
a rendered figure ABOVE it would mean the polarity is not what we think and is a finding.

CALIBRATED ON smoke-3d, AND ONE DISAGREEMENT NAMED RATHER THAN SMOOTHED: run against those
four frames this tool returns contrast_core 6.40 on all four - reproducing the declared value
exactly - and contrast_mean 5.55-5.76. The 3d README recorded 6.09/5.94. THAT IS NOT THE SAME
ESTIMATOR: mine counts every pixel within FG_TOLERANCE of the declared colour, so it admits
lighter antialiased edge pixels and reads lower. Neither figure is wrong; they average
different populations, and a claim that one "confirms" the other would be two spellings of one
question rather than two instruments. What all three readings agree on is the only thing the
threshold asks: 5.55, 6.09 and 6.40 all clear the AA floor of 4.5, so the verdict does not
depend on which estimator a reader prefers.

GEOMETRY, CALIBRATED: those same four frames measure h=31 with 2 text lines (at gap 3; gaps 6
and 9 merge the lines, which is why the height and not the line count is load-bearing). The
second-step texts are the long ones by construction. A first-step line is one sentence, so it
should measure roughly half that height - and if it does not, the frame is not showing what
the network condition says it is showing.
"""
import argparse
import hashlib
import json
import pathlib
import re
import sys
from collections import Counter

MIN_DISTINCT_COLOURS = 50
# The refusal line's declared colour, dist/index.html: color:#991b1b on the entry overlay.
REFUSAL_FG = (0x99, 0x1b, 0x1b)
# How close a pixel must be to the declared foreground to count as a glyph core.
FG_TOLERANCE = 40
KEY_PREFIX = "settings.crewing.login."
STATES = {
    "S1": "transport_unreachable",
    "S2": "upstream_unavailable",
    "S3": "workspace_unreachable",
    "S4": "workspace_unavailable",
}


def die(message, code=2):
    print(f"STOP: {message}")
    raise SystemExit(code)


def sha256_file(path):
    return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()


# --------------------------------------------------------------------------- capture
def cmd_capture(args):
    """Grab the whole Xephyr root window. Not the owner's display: the display number is
    required and checked against a refusal list, so a typo cannot photograph :1."""
    if args.display in ("0", "1", ":0", ":1"):
        die(f"display {args.display} is the owner's - refusing to capture it", 9)
    try:
        from Xlib import display as xdisplay
        from Xlib import X
        from PIL import Image
    except ImportError as exc:
        die(f"capture needs python-Xlib and PIL: {exc}", 3)

    disp = xdisplay.Display(f":{args.display.lstrip(':')}")
    root = disp.screen().root
    geom = root.get_geometry()
    raw = root.get_image(0, 0, geom.width, geom.height, X.ZPixmap, 0xFFFFFFFF)
    # Xephyr at depth 24 hands back 4 bytes per pixel, blue first.
    image = Image.frombytes("RGB", (geom.width, geom.height), raw.data, "raw", "BGRX")

    distinct = len(set(image.getdata()))
    if distinct < MIN_DISTINCT_COLOURS:
        die(
            f"POSITIVE CONTROL FAILED: the frame holds {distinct} distinct colours "
            f"(floor {MIN_DISTINCT_COLOURS}). A near-uniform frame is what a broken capture "
            f"or an unmapped window produces; it is not evidence that the app drew nothing",
            10,
        )
    out = pathlib.Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    image.save(out)
    print(f"captured {geom.width}x{geom.height} -> {out}  distinct_colours={distinct}  sha256={sha256_file(out)}")


# --------------------------------------------------------------------------- analyze
def luminance(rgb):
    def channel(value):
        value /= 255.0
        return value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(fg, bg):
    a, b = luminance(fg), luminance(bg)
    lighter, darker = max(a, b), min(a, b)
    return (lighter + 0.05) / (darker + 0.05)


def cmd_analyze(args):
    try:
        from PIL import Image
    except ImportError as exc:
        die(f"analyze needs PIL: {exc}", 3)

    image = Image.open(args.frame).convert("RGB")
    width, height = image.size
    pixels = image.load()

    glyph = []
    for y in range(height):
        for x in range(width):
            r, g, b = pixels[x, y]
            if (
                abs(r - REFUSAL_FG[0]) <= FG_TOLERANCE
                and abs(g - REFUSAL_FG[1]) <= FG_TOLERANCE
                and abs(b - REFUSAL_FG[2]) <= FG_TOLERANCE
            ):
                glyph.append((x, y))

    result = {
        "frame": str(args.frame),
        "sha256": sha256_file(args.frame),
        "size": [width, height],
        "glyph_pixels": len(glyph),
    }

    if not glyph:
        # A zero here is reported, never silently turned into "no refusal". The caller decides
        # whether a refusal was expected; this tool only says what it found.
        result["refusal_box"] = None
        result["verdict"] = "NO_PIXELS_NEAR_DECLARED_REFUSAL_COLOUR"
        print(json.dumps(result, indent=2, ensure_ascii=False))
        return

    xs = [p[0] for p in glyph]
    ys = [p[1] for p in glyph]
    x0, x1, y0, y1 = min(xs), max(xs), min(ys), max(ys)
    rows = sorted({y for _, y in glyph})
    # HOW MANY LINES: reported at three gap thresholds rather than one, because a single
    # threshold is a fragile claim. Calibrated on smoke-3d, whose two-line second-step texts
    # measure h=31: a gap of 6 merged both lines into "1", so the HEIGHT is the trustworthy
    # discriminator and the line count is context for it, not the measurement.
    result["lines_by_gap"] = {}
    for gap in (3, 6, 9):
        count = 1
        for previous, current in zip(rows, rows[1:]):
            if current - previous > gap:
                count += 1
        result["lines_by_gap"][str(gap)] = count
    result["occupied_scanlines"] = len(rows)

    box = image.crop((x0, y0, x1 + 1, y1 + 1))
    counts = Counter(box.convert("RGB").getdata())
    background = counts.most_common(1)[0][0]
    darkest = min(glyph, key=lambda p: sum(pixels[p[0], p[1]]))
    core = pixels[darkest[0], darkest[1]]
    mean = tuple(round(sum(pixels[x, y][i] for x, y in glyph) / len(glyph)) for i in range(3))

    result["refusal_box"] = {"x": x0, "y": y0, "w": x1 - x0 + 1, "h": y1 - y0 + 1}
    result["background_rgb"] = list(background)
    # TWO CONTRAST FIGURES, because they answer DIFFERENT questions and a single number here
    # would quietly pick one. Measured on smoke-3d: core gives 6.40, the declared value, while
    # that run's README recorded 6.09/5.94 - the gap is antialiasing, not disagreement.
    #   core: the darkest glyph pixel vs the modal background. Asks "did the DECLARED colour
    #         actually land on screen", so it should reproduce 6.40 exactly.
    #   mean: averaged over every glyph pixel, antialiased edges included. Asks "what does a
    #         reader meet", and for dark-on-light text it UNDERSTATES, which is why it lands
    #         below the declared figure rather than above it.
    result["foreground_core_rgb"] = list(core)
    result["foreground_mean_rgb"] = list(mean)
    result["contrast_core"] = round(contrast_ratio(core, background), 2)
    result["contrast_mean"] = round(contrast_ratio(mean, background), 2)
    result["contrast_declared"] = 6.40
    result["wcag_aa_floor"] = 4.5
    result["verdict"] = "REFUSAL_BOX_FOUND"
    print(json.dumps(result, indent=2, ensure_ascii=False))


# --------------------------------------------------------------------------- text
def cmd_text(args):
    """Read the four texts out of the shipped dist, by key, for one language."""
    dist = pathlib.Path(args.dist)
    actual = sha256_file(dist)
    if actual != args.dist_sha:
        die(f"dist sha mismatch: pinned {args.dist_sha}, on disk {actual}", 4)

    text = dist.read_text(encoding="utf-8")
    # ASK WHICH TABLE EACH KEY OCCURRENCE LIVES IN, rather than where "the" table is. Measured
    # on this dist: the openers do NOT share a shape - `en: {` sits at indent 4 and `ru: {` at
    # indent 2, one opener carries a tab, and there are FOUR `en:` tables in the file. A regex
    # pinned to one indentation found en and silently missed ru. So: locate every opener, then
    # attribute each key hit to the nearest opener ABOVE it.
    openers = [(m.start(), m.group(1)) for m in re.finditer(r'^[ \t]*([a-z]{2})[ \t]*:[ \t]*\{[ \t]*$', text, re.M)]
    if not openers:
        die("no language table openers found at all - the instrument is blind, not the file empty", 5)

    def owning_lang(position):
        lang = None
        for start, code in openers:
            if start < position:
                lang = code
            else:
                break
        return lang

    found = {}
    for state, code in STATES.items():
        key = KEY_PREFIX + code
        # Keys here are DOUBLE-quoted. A single-quoted pattern returns a lying zero on this
        # file - measured earlier today, which is why the quoting is stated and not assumed.
        for hit in re.finditer(r'"%s":\s*"((?:[^"\\]|\\.)*)"' % re.escape(key), text):
            lang = owning_lang(hit.start())
            # json.loads does the unescaping: \uXXXX and \" handled, UTF-8 preserved. A
            # `.encode().decode("unicode_escape")` round-trip goes through latin-1 and turns
            # every em-dash into mojibake - measured on this very file.
            found.setdefault(lang, {})[state] = {
                "code": code,
                "text": json.loads('"%s"' % hit.group(1)),
            }

    if args.lang not in found:
        die(f"no {args.lang} occurrence of the login keys (languages present: {sorted(found)})", 5)
    out = found[args.lang]
    missing = [s for s in STATES if s not in out]
    if missing:
        die(f"states absent from the {args.lang} table: {missing}", 6)

    if len({v["text"] for v in out.values()}) != len(out):
        die("two of the four texts are identical in this language - the show could not tell them apart", 7)

    # POSITIVE CONTROL ON THE TEXT, not on the fact of switching: every state's string in this
    # language must DIFFER from the same state's string in the other shipped language. Without
    # this, a stand that failed to switch language would still be reported as two languages.
    other = "en" if args.lang == "ru" else "ru"
    same_as_other = []
    if other in found:
        same_as_other = [s for s in out if other in found and s in found[other]
                         and found[other][s]["text"] == out[s]["text"]]
    print(json.dumps({
        "lang": args.lang,
        "dist_sha256": actual,
        "states": out,
        "identical_to_%s" % other: same_as_other,
    }, indent=2, ensure_ascii=False))


# --------------------------------------------------------------------------- find-fill
def cmd_find_fill(args):
    """Locate a FILLED button by its background colour and print a click point.

    WHY NOT HARD-CODED COORDINATES: a pixel pair in a driver is a guess that survives review
    because nobody can see it is wrong until the click lands somewhere else. This measures the
    target in the frame the app actually drew, so a layout that moved makes the stage STOP
    rather than click into empty space.

    WHY ROWS AND NOT A BOUNDING BOX: on the entry screen two controls carry the accent colour -
    the login door is FILLED with it and the register door only has a 1px accent BORDER. A
    bounding box over all accent pixels would span both and point between them. A filled row
    holds hundreds of accent pixels and a border row holds about two, so thresholding per ROW
    separates them without any connected-component machinery.
    """
    try:
        from PIL import Image
    except ImportError as exc:
        die(f"find-fill needs PIL: {exc}", 3)

    target = tuple(int(args.rgb[i:i + 2], 16) for i in (0, 2, 4))
    image = Image.open(args.frame).convert("RGB")
    width, height = image.size
    pixels = image.load()

    per_row = {}
    for y in range(height):
        xs = [
            x for x in range(width)
            if all(abs(pixels[x, y][i] - target[i]) <= args.tolerance for i in range(3))
        ]
        if len(xs) >= args.min_run:
            per_row[y] = xs

    if not per_row:
        die(
            f"no row holds {args.min_run}+ pixels within {args.tolerance} of #{args.rgb} - "
            f"no FILLED control of that colour is on this frame",
            11,
        )

    # Take the widest contiguous band of qualifying rows: that is one button, not two.
    rows = sorted(per_row)
    bands, current = [], [rows[0]]
    for previous, now in zip(rows, rows[1:]):
        if now - previous <= 2:
            current.append(now)
        else:
            bands.append(current)
            current = [now]
    bands.append(current)
    band = max(bands, key=len)

    x_lo = min(min(per_row[y]) for y in band)
    x_hi = max(max(per_row[y]) for y in band)
    print(json.dumps({
        "frame": str(args.frame),
        "target_rgb": f"#{args.rgb}",
        "band_rows": [band[0], band[-1]],
        "box": {"x": x_lo, "y": band[0], "w": x_hi - x_lo + 1, "h": band[-1] - band[0] + 1},
        "click_x": (x_lo + x_hi) // 2,
        "click_y": (band[0] + band[-1]) // 2,
        "bands_found": len(bands),
    }, indent=2))


# --------------------------------------------------------------------------- proxy503
def cmd_proxy503(args):
    """A proxy that accepts the TCP connection and refuses the CONNECT with 503.

    WHAT IT IS FOR: the coordinator's prediction is that this still yields S1
    (`transport_unreachable`), not S2 (`upstream_unavailable`), because `upstream_unavailable`
    is born only inside `response_json(status, &bytes, login)` - reached only after
    `request.send()` has SUCCEEDED and the body has been read. A refused CONNECT means the
    tunnel never stands up, so `send()` returns an error. The run exists to TEST that
    prediction rather than publish it.

    IT CANNOT REACH PRODUCTION: it never dials anything. Every CONNECT is answered 503 and the
    socket closed, so pointing the app at it makes `assistant.skipi.app` unreachable by
    construction - the same protection the closed-port condition gives, with a live listener.
    """
    import socket
    import threading

    log = pathlib.Path(args.log)
    log.parent.mkdir(parents=True, exist_ok=True)
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    try:
        server.bind(("127.0.0.1", args.port))
    except OSError as exc:
        # A BUSY PORT IS WEATHER, NOT A VERDICT. Exit 17 so the caller can retry on another
        # port and record a finding, instead of losing a stage because something unrelated
        # holds the address. The ports this stage uses sit BELOW the kernel's ephemeral range
        # (32768-60999 here, with 166 sockets in it right now and no reserved list), so the
        # kernel never hands them out - but "never handed out by the kernel" is not "nobody
        # ever binds it", and an instrument that dies of that loses the stage to chance.
        print(f"BIND_FAILED port={args.port} errno={exc.errno} {exc.strerror}")
        raise SystemExit(17)
    server.listen(16)
    lines = []

    def serve():
        while True:
            try:
                conn, _ = server.accept()
            except OSError:
                return
            try:
                conn.settimeout(2.0)
                data = b""
                try:
                    while b"\r\n\r\n" not in data and len(data) < 8192:
                        chunk = conn.recv(4096)
                        if not chunk:
                            break
                        data += chunk
                except OSError:
                    pass
                first = data.split(b"\r\n", 1)[0].decode("latin-1", "replace")
                lines.append(first)
                log.write_text("\n".join(lines) + "\n", encoding="utf-8")
                conn.sendall(
                    b"HTTP/1.1 503 Service Unavailable\r\n"
                    b"Content-Length: 0\r\nConnection: close\r\n\r\n"
                )
            finally:
                conn.close()

    threading.Thread(target=serve, daemon=True).start()
    print(f"proxy503 listening on 127.0.0.1:{args.port}, requests logged to {log}", flush=True)
    try:
        import time
        time.sleep(args.seconds)
    finally:
        server.close()
    log.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"proxy503 stopping after {args.seconds}s, {len(lines)} request line(s) seen")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="cmd", required=True)

    cap = sub.add_parser("capture", help="grab the Xephyr root window to a PNG")
    cap.add_argument("--display", required=True)
    cap.add_argument("--out", required=True)
    cap.set_defaults(func=cmd_capture)

    ana = sub.add_parser("analyze", help="measure the refusal line in a frame")
    ana.add_argument("--frame", required=True)
    ana.set_defaults(func=cmd_analyze)

    txt = sub.add_parser("text", help="read the four texts out of the shipped dist")
    txt.add_argument("--dist", required=True)
    txt.add_argument("--dist-sha", required=True)
    txt.add_argument("--lang", required=True)
    txt.set_defaults(func=cmd_text)

    fil = sub.add_parser("find-fill", help="locate a filled button by colour, print a click point")
    fil.add_argument("--frame", required=True)
    fil.add_argument("--rgb", required=True, help="six hex digits, no leading #")
    fil.add_argument("--tolerance", type=int, default=12)
    fil.add_argument("--min-run", type=int, default=120)
    fil.set_defaults(func=cmd_find_fill)

    prx = sub.add_parser("proxy503", help="a CONNECT-refusing proxy, to test the S2 prediction")
    prx.add_argument("--port", type=int, required=True)
    prx.add_argument("--seconds", type=int, default=60)
    prx.add_argument("--log", required=True)
    prx.set_defaults(func=cmd_proxy503)

    args = parser.parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
