#!/usr/bin/env python3
"""Does a stage driver's PROSE agree with its own CODE?

Written because the same class of defect appeared SIX times in one day, every instance caught
by a reviewer rather than by me, and every instance fixed by hand. A rule in a catalogue does
not fire; a predicate does. Each driver is adapted by copy from the previous one, so every
sentence that names a count, a file or a subject is inherited and silently becomes false.

Three predicates, each stated as what it would catch:

  usage-names-self   the `# Usage:` line must name THIS file. Catches "run-s3d.sh" surviving
                     into run-s3e.sh.
  count-agrees       a sentence claiming "all N PRE digests" must match how many PRE digest
                     comparisons the code actually performs. Catches "all three" when four are
                     checked. Porcelain file-count and digest-count are DIFFERENT populations
                     and are counted separately.
  subject-announced  a `say "... POST pinned to $X"` must announce a variable that is actually
                     this stage's SUBJECT, i.e. one whose PRE pin differs from its POST pin.
                     Announcing a file pinned equal on both sides announces a non-subject and
                     prints a value that proves nothing.

Stage tokens from earlier stages are REPORTED, never failed: some are legitimate history (the
F12 attribution of where a bad predicate came from), and a checker that cannot tell history
from staleness must not pretend to.
"""
import re, sys, os

def check(path):
    s = open(path).read()
    base = os.path.basename(path)
    out, bad = [], []

    m = re.search(r'^#\s*Usage:\s*(\S+)', s, re.M)
    if not m:
        bad.append("usage-names-self: no `# Usage:` line at all")
    elif m.group(1) != base:
        bad.append("usage-names-self: usage says %r, file is %r" % (m.group(1), base))
    else:
        out.append("usage-names-self: ok (%s)" % base)

    pre_cmps = re.findall(r'\[\s*"\$(\w+?)0"\s*=\s*"\$(\w+_PRE)"\s*\]', s)
    claims = re.findall(r'say "preconditions:[^"]*?\ball (\w+) PRE digests', s)
    words = {"one":1,"two":2,"three":3,"four":4,"five":5,"six":6,"seven":7,"eight":8}
    if claims:
        claimed = words.get(claims[0].lower())
        if claimed is None:
            bad.append("count-agrees: claim %r is not a number word" % claims[0])
        elif claimed != len(pre_cmps):
            bad.append("count-agrees: prose claims %s PRE digests, code compares %d (%s)"
                       % (claims[0], len(pre_cmps), ", ".join(p[1] for p in pre_cmps)))
        else:
            out.append("count-agrees: ok (%d PRE digest comparisons)" % len(pre_cmps))
    else:
        out.append("count-agrees: no numeric claim to check")

    pins = dict(re.findall(r'^(\w+_(?:PRE|POST))=([0-9a-f]{64})\s*$', s, re.M))
    subjects = {k[:-5] for k in pins if k.endswith("_POST")
                and pins.get(k[:-5]+"_PRE") and pins[k[:-5]+"_PRE"] != pins[k]}
    # The variable need NOT be the last thing in the say. Requiring a closing quote right after
    # it silently DISABLED this predicate the moment a driver explained itself after naming the
    # subject - i.e. the wording that fixed the defect blinded the guard that watches it. The
    # failure mode is the dangerous one: not "weaker than it sounds" but "not running", while
    # still printing nothing and exiting 0. So: find each `say` string, then look inside it.
    announced = []
    for say in re.findall(r'say "((?:[^"\\]|\\.)*)"', s):
        if "POST pinned to" not in say:
            continue
        m2 = re.search(r'\$(\w+_POST)', say)
        announced.append(m2.group(1) if m2 else None)
    if not announced:
        out.append("subject-announced: no announcement to check")
    for var in [a for a in announced if a]:
        stem = var[:-5]
        if stem in subjects:
            out.append("subject-announced: ok (%s is this stage's subject)" % var)
        elif pins.get(stem+"_PRE") == pins.get(var):
            bad.append("subject-announced: announces %s, but its PRE and POST pins are EQUAL - "
                       "it is not the subject; the subject(s) are %s"
                       % (var, ", ".join(sorted(s_+"_POST" for s_ in subjects)) or "none"))
        else:
            # CANNOT RESOLVE is not the same verdict as WRONG. 3c selects its POST pin at run
            # time from DIST_POST_A/DIST_POST_B by register, so no literal `DIST_POST=<hex>`
            # line exists - and its announcement was correct. Failing that would be a false
            # positive, and a checker that cries wolf on a sound driver is a checker people
            # learn to ignore. Report, and say what would make it decidable.
            alts = sorted(k for k in pins if k.startswith(stem + "_POST"))
            out.append("subject-announced: UNRESOLVED for %s - no literal pin pair%s; "
                       "the predicate abstains rather than guessing"
                       % (var, (" (selected at run time from %s)" % ", ".join(alts)) if alts else ""))

    tokens = sorted(set(re.findall(r'\b(F12|3[a-e])\b', s)))
    out.append("stage tokens present (REPORT, not a verdict): %s" % (tokens or "none"))
    return out, bad

rc = 0
for p in sys.argv[1:]:
    ok, bad = check(p)
    print("== %s ==" % os.path.basename(p))
    for l in ok:  print("   ok   %s" % l)
    for l in bad: print("   FAIL %s" % l); 
    if bad: rc = 1
sys.exit(rc)
