#!/usr/bin/env python3
"""3d: make the login refusal line readable, and pin that it stays readable.

The colour is a HOUSE defect, not 3c's: dist <style> blocks and this element's inline
attribute are byte-identical to base f145c601, and patch-s3c-dist.py contains no style at all.
`#fca5a5` is Tailwind red-300 - a dark-theme red - sitting on a light panel. Measured 1.46:1
declared / 1.96:1 rendered, against a 4.5:1 AA floor, while every other element on the same
screen runs 4.85-15.32:1.

Radius of the EDIT: one occurrence in the file. Radius of the EFFECT: all 28 refusal codes
that route through loginRefusalText on the desktop path. Those are different numbers and both
are reported.

The harness assert exists because the house rule requires a caught bug to get its regression
test in the same fix - this was a red-review finding by the manager.
"""
import argparse, hashlib, os, sys

OLD_COLOR = "color:#fca5a5;"
NEW_COLOR = "color:#991b1b;"
ELEMENT = 'id="ec-login-error"'

ASSERT_ANCHOR = """  for(const v of values){"""
ASSERT_NEW = '''  // No.898 3d: the refusal line must be READABLE, not merely correct. Caught by the manager
  // reading the smoke frames: the text was the palest thing on the screen - declared 1.46:1
  // against a 4.5:1 AA floor, while the heading ran 15.32:1 and plain body text 5.37:1.
  // The colour was a HOUSE defect (inline attribute byte-identical to base f145c601), but a
  // fix without a guard is a fix that comes back, so the floor is pinned here.
  // The panel is translucent, so the background is COMPOSITED from the declared rgba over the
  // light --bg token; that model was validated against the real pixels of a captured frame
  // (predicted rgb(242,221,223) vs measured rgb(242,221,222), a rounding difference).
  {
    const el=(html.match(/id="ec-login-error"[^>]*/)||[''])[0];
    const fg=(el.match(/color:#([0-9a-fA-F]{6})/)||[])[1];
    const bgm=el.match(/background:rgba\\((\\d+),\\s*(\\d+),\\s*(\\d+),\\s*([\\d.]+)\\)/);
    // The LIGHT theme's --bg, and only it: the dark one is declared first on bare :root, so a
    // pattern that merely mentions data-theme="light" nearby captures the WRONG value. This
    // error happened and the discriminating control below is what exposed it, by scoring the
    // replaced colour at 9.06:1 instead of 1.46:1.
    // The SELECTOR `:root[data-theme="light"]`, not the bare attribute: `<html
    // data-theme="light">` sits at offset 32, long before the CSS, so anchoring on the
    // attribute captures the DARK --bg declared first on bare :root. Require the closing `]`.
    const page=(html.match(/data-theme="light"\\][\\s\\S]{0,800}?--bg:\\s*#([0-9a-fA-F]{6});/)||[])[1];
    ok(!!fg&&!!bgm&&!!page,'No.898/3d: the refusal box declares a colour, a translucent background and a light --bg :: fg='+fg+' bg='+(bgm&&bgm[0])+' page='+page);
    const hex=(h)=>[0,2,4].map((i)=>parseInt(h.slice(i,i+2),16));
    const lin=(v)=>{v/=255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
    const lum=(c)=>0.2126*lin(c[0])+0.7152*lin(c[1])+0.0722*lin(c[2]);
    const ratio=(a,b)=>{const la=lum(a),lb=lum(b),hi=Math.max(la,lb),lo=Math.min(la,lb);return (hi+0.05)/(lo+0.05);};
    const over=(c,bg,a)=>c.map((v,i)=>Math.round(a*v+(1-a)*bg[i]));
    // Guard against extracting the WRONG theme's background - the failure that actually
    // happened twice here. A light theme's page colour must be light; if this fires, the
    // contrast number below is about the wrong surface and means nothing.
    ok(lum(hex(page))>0.5,'control: the extracted light-theme --bg is actually light :: #'+page+' relative luminance '+lum(hex(page)).toFixed(3));
    const panel=over([+bgm[1],+bgm[2],+bgm[3]],hex(page),parseFloat(bgm[4]));
    const got=ratio(hex(fg),panel);
    ok(got>=4.5,'No.898/3d: the refusal line meets the WCAG AA floor for body text :: '+got.toFixed(2)+' : 1 on composited panel rgb('+panel+'), floor 4.5');
    // The predicate must DISCRIMINATE: the colour this replaced has to fail it, or the assert
    // would pass on anything and prove nothing.
    const wasRatio=ratio(hex('fca5a5'),panel);
    ok(wasRatio<3,'control: the predicate rejects the colour this replaced :: #fca5a5 scores '+wasRatio.toFixed(2)+' : 1, below even the 3:1 large-text floor');
  }

''' + ASSERT_ANCHOR

def write_atomic(path, text):
    tmp = path + ".tmp"
    open(tmp, "w").write(text)
    os.chmod(tmp, os.stat(path).st_mode & 0o7777)
    os.replace(tmp, path)
    if open(path).read() != text:
        sys.exit("REFUSE: re-read differs")

def once(t, needle, label):
    n = t.count(needle)
    if n != 1:
        sys.exit("REFUSE: anchor %r found %d times (want 1)" % (label, n))

ap = argparse.ArgumentParser()
ap.add_argument("--root", required=True)
a = ap.parse_args()

dist = os.path.join(a.root, "dist/index.html")
h = open(dist).read()
print("dist sha256 before: %s mode %o" % (hashlib.sha256(h.encode()).hexdigest()[:16], os.stat(dist).st_mode & 0o7777))
once(h, OLD_COLOR, "the pale colour")
el = [s for s in h.split(">") if ELEMENT in s]
if len(el) != 1 or OLD_COLOR not in el[0]:
    sys.exit("REFUSE: the pale colour is not on ec-login-error as expected")
h = h.replace(OLD_COLOR, NEW_COLOR)
if h.count(NEW_COLOR) != 1 or "#fca5a5" in h:
    sys.exit("REFUSE: replacement did not land exactly once")
write_atomic(dist, h)
print("dist sha256 after:  %s mode %o" % (hashlib.sha256(open(dist).read().encode()).hexdigest()[:16], os.stat(dist).st_mode & 0o7777))

hp = os.path.join(a.root, "tests/crewing635_public_settings_harness.mjs")
s = open(hp).read()
print("harness sha256 before: %s mode %o" % (hashlib.sha256(s.encode()).hexdigest()[:16], os.stat(hp).st_mode & 0o7777))
once(s, ASSERT_ANCHOR, "per-value loop")
s = s.replace(ASSERT_ANCHOR, ASSERT_NEW)
write_atomic(hp, s)
print("harness sha256 after:  %s mode %o" % (hashlib.sha256(open(hp).read().encode()).hexdigest()[:16], os.stat(hp).st_mode & 0o7777))
