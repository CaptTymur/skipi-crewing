#!/usr/bin/env python3
"""Build / advance a No.898 coordinator bundle. Every value is measured at run time.

Conventions taken from skipi-parallel-coordinator/REQUEST-SCHEMA.md (the published
authority; names are NOT guessed):
  * 13 required non-empty STRINGS per stream; `new`/`preserve`/`stop` are strings,
    never arrays.
  * all 13 surface categories present, empty ones included - absent means "forgotten".
  * every real file on disk is declared `path:` with an absolute path. `card:`/`guard:`
    stay for non-file abstractions, because overlaps() compares kind FIRST and so is
    blind to one file declared under two kinds.
  * no annotation inside a token - it makes overlaps() false. Prose goes in notes.
  * evidence_files REQUIRED for every stage except START and PREP.
  * the two-step marker is a TOP-LEVEL `submission` OBJECT. A flat `submission_mode`
    is rejected. `mode` is one bare token; explanation goes in `note`.
  * step 3 may differ from the reviewed step 1 ONLY in streams[*].event_id,
    streams[*].heartbeat, any `heartbeat_note`, and the whole `submission` subtree.
    So no other field may carry a value that moves on its own - the coordinator-instance
    read time therefore lives INSIDE `submission`.
  * the neighbour is named in `active_neighbors` prose, never as a second stream: a
    declared stream owes the same 13 checks and its own evidence_files, which cannot be
    produced on its behalf.

Usage:
  build-request.py new   <STAGE> <LABEL> <review-only|grant> [--files f1,f2,...]
  build-request.py step3 <path-to-step1.json>
"""
import hashlib, json, os, subprocess, sys
from datetime import datetime, timezone

HOME_REPO = "/home/linux/Developer/skipi-crewing"   # my artefacts always live here
REPO = os.environ.get("CREWING_REQUEST_REPO", HOME_REPO)  # the repo the stage declares
OPS  = "/home/linux/Developer/skipi-ops"
CARD_REL = "handoffs/TASKCARD-2026-11-04-crewing-898-login-texts.md"
COORD = "/home/linux/Developer/skipi-parallel-coordinator"
OUT = os.path.join(HOME_REPO, "scratchpad/crewing-898/coord")
STAGES = {"START","PREP","IMPLEMENT","VERIFY_BUILD","OWNER_REVIEW","INTEGRATE","FINALIZE_END"}
SURFACES = ("code","contracts","schema","generated","tests","database","ports","cache",
            "build","guard","release","card","logs")
NO_EVIDENCE_NEEDED = {"START","PREP"}

def git(repo, *a, text=True):
    return subprocess.check_output(["git","-C",repo,*a], text=text)

def sha_bytes(b): return hashlib.sha256(b).hexdigest()
def sha_path(p):
    with open(p,"rb") as f: return sha_bytes(f.read())

def canonical(bundle):
    return sha_bytes(json.dumps(bundle, sort_keys=True, ensure_ascii=False,
                                separators=(',',':')).encode())

def measure():
    """Everything that is a property of the moment, in one place."""
    m = {}
    m["head"] = git(REPO,"rev-parse","HEAD").strip()
    m["status_norm_sha"] = sha_bytes(git(REPO,"status","--porcelain=v1",
                                         "--untracked-files=normal", text=False))
    # The -uall enumeration lists every untracked file INCLUDING the request bundles this
    # script writes, so declaring it raw makes the field move every time a bundle is built -
    # i.e. self-invalidating, and step 3 could never match the reviewed step 1. Exclude this
    # slice's own declared log subtree and SAY SO inside the value: a filtered measurement
    # must carry its filter. status_sha256 (normal mode) stays unfiltered - it is what the
    # gate compares, and `scratchpad/` collapses to one line there, so it is stable anyway.
    # The self-log exclusion applies ONLY when the declared repo IS the canonical checkout,
    # because that is the only tree my artefacts live in. Declaring an exclusion for a path
    # that cannot appear reads as "something was hidden" when there is nothing to hide - the
    # coordinator measured the worktree at 0 untracked lines in BOTH units.
    SELF = "scratchpad/crewing-898/"
    raw = git(REPO,"status","--porcelain=v1","--untracked-files=all")
    if REPO == HOME_REPO:
        kept = [ln for ln in raw.splitlines() if SELF not in ln]
        m["untracked"] = ("EXCLUDES this slice's own declared log subtree %s (artefacts written by "
                          "this generator, covered by logs.writes); everything else verbatim:\n%s"
                          % (SELF, "\n".join(kept)))
    else:
        kept = raw.splitlines()
        m["untracked"] = ("No exclusion applies: the declared repo is not the checkout my artefacts "
                          "live in, so this is the raw --untracked-files=all output, %d line(s)%s"
                          % (len(kept), (":\n" + "\n".join(kept)) if kept else " (empty)."))
    # UNIT, named because its neighbour has a different one: this is sha256 of the RAW BYTES of
    # `git -C <repo> status --porcelain=v1 --untracked-files=all`, trailing newline INCLUDED -
    # the same unit as status_sha256. Until now it was sha256("\n".join(output.splitlines())),
    # which silently dropped git's trailing newline, so two fields named alike carried different
    # units. Same family as the .strip() defect in my notes: a helper written fresh lost a
    # correction the fixed one already had.
    m["status_all_sha"] = sha_bytes(raw.encode())
    m["status_all_sha_command"] = ("sha256 of the raw bytes of: git -C <repo> status --porcelain=v1 "
                                   "--untracked-files=all  (trailing newline included)")
    m["live_main"] = git(REPO,"ls-remote","origin","refs/heads/main").split()[0]
    m["cached_main"] = git(REPO,"rev-parse","origin/main").strip()
    card_abs = os.path.join(OPS, CARD_REL)
    m["card_abs"] = card_abs
    m["card_file"] = sha_path(card_abs)
    m["card_head"] = sha_bytes(git(OPS,"show","HEAD:"+CARD_REL, text=False))
    m["ops_head"] = git(OPS,"rev-parse","HEAD").strip()
    # CARD-SCOPED, because the whole-tree porcelain moves at the MANAGER's discretion: he edits
    # AGENTS/BACKLOG/DECISIONS/PROJECT_STATE live, and a stream field that moves on someone else's
    # keystrokes turns a step-3 re-filing into a new object with no error of mine. It did exactly
    # that: 5 lines at step 1, 6 at step 3, none of them my card. The provenance claim that MATTERS
    # is about MY card, so that is what the stream carries; the volatile whole-tree reading moves
    # into `submission`, the one subtree step 3 may legally change.
    m["card_porcelain"] = git(OPS,"status","--porcelain=v1","--",CARD_REL)
    m["ops_porcelain_volatile"] = git(OPS,"status","--porcelain=v1")
    try:
        cs = json.load(open(os.path.join(COORD,"reports/coordination-state.json")))
        m["coord_instance"], m["coord_epoch"] = cs.get("instance"), cs.get("epoch")
    except (OSError, ValueError):
        m["coord_instance"], m["coord_epoch"] = None, None
    return m

def load_content(path):
    """Free-text fields live in a FILE, never in my hands: step 3 must reproduce the
    reviewed step 1 byte for byte outside the allowed paths, and re-typed prose cannot."""
    if not path: return {}
    with open(path) as f: return json.load(f)

def build(stage, label, mode, files, m, now, content=None, content_file_recorded=None):
    hb = now.isoformat()
    event_id = "crewing-898-%s-%s-%s" % (stage, label, now.strftime("%Y%m%dT%H%M%SZ"))
    empty = lambda: {"reads": [], "writes": []}
    ro = lambda *r: {"reads": list(r), "writes": []}
    s = {k: empty() for k in SURFACES}
    s["code"]      = ro("path:"+REPO+"/src-tauri/src", "path:"+REPO+"/dist/index.html")
    s["tests"]     = ro("path:"+REPO+"/tests")
    s["contracts"] = ro("path:/home/linux/Developer/skipi-contracts")
    s["guard"]     = ro("path:/home/linux/Developer/skipi-guard/configs/homes/crewing.json",
                        "path:/home/linux/Developer/skipi-guard/bin/skipi-guard")
    # Real files on disk, so path: - not card: - despite sitting in the `card` category.
    s["card"]      = ro("path:"+m["card_abs"], "path:"+OPS+"/BACKLOG.md", "path:"+OPS+"/DECISIONS.md")
    stage_logs = os.path.normpath(os.path.join(OUT, "..", "stage-%s-%s" % (stage.lower(), label)))  # under HOME_REPO, never the declared repo
    s["logs"]      = {"reads": [], "writes": ["path:"+stage_logs]}
    if stage in {"IMPLEMENT","VERIFY_BUILD"}:
        s["code"]["writes"]  = ["path:"+REPO+"/dist/index.html"]
        s["tests"]["writes"] = ["path:"+REPO+"/tests"]

    missing = [p for p in files if not os.path.isfile(p)]
    if missing:
        print("REFUSING: declared evidence file(s) absent from disk - a pin cannot be "
              "computed for a file that is not there:", file=sys.stderr)
        for p in missing: print("   " + p, file=sys.stderr)
        print("If the file exists only at live main, the stage needs a worktree FIRST.", file=sys.stderr)
        sys.exit(6)
    evidence = [{"path": p, "sha256": sha_path(p)} for p in files]
    if stage not in NO_EVIDENCE_NEEDED and not evidence:
        print("REFUSING: stage %s requires evidence_files; pass --files" % stage, file=sys.stderr)
        sys.exit(4)

    stream = {
      "stream_id": "crewing/898-client-slice",
      "writer": "crewing-writer@skipi-crewing-17",
      "event_id": event_id,
      "stage": stage,
      "outcome": "SET BEFORE SENDING - the generator does not invent it",
      "repo": REPO,
      "head": m["head"],
      "status_sha256": m["status_norm_sha"],
      "status_sha256_uall": m["status_all_sha"],
      "status_sha256_uall_command": m["status_all_sha_command"],
      "untracked": m["untracked"],
      "new": "SET BEFORE SENDING",
      "preserve": "SET BEFORE SENDING",
      "owner": "crewing-writer@skipi-crewing-17; integration owner = manager (skipi-ops-28)",
      "stop": "SET BEFORE SENDING",
      "heartbeat": hb,
      "heartbeat_note": "review-only pulse; do not compute a window from it" if mode=="review-only" else "grant pulse",
      "proves": "SET BEFORE SENDING",
      "depends": "SET BEFORE SENDING",
      "active_neighbors": "SET BEFORE SENDING - prose, never a second declared stream",
      "next_action": "SET BEFORE SENDING",
      "owner_window": "SET BEFORE SENDING",
      "card_provenance": {
        "cited_by": "field name plus the digest read; never by line number",
        "path": m["card_abs"],
        # NAMED FOR THE STATE IT MEANS. A bare `sha256_file` reads as a claim about the file
        # AS IT IS NOW and is compared against disk - but this card belongs to the manager and
        # moves on his keystrokes, so the honest claim is "this is what I read, at this time".
        # preflight_pins reports the bare name under `unrecognised_sha_names` (a warning, not a
        # block); the recognised state suffixes are published in REQUEST-SCHEMA.md.
        "sha256_file_at_read": m["card_file"],
        # THE TIMESTAMP LIVES IN `submission`, NOT HERE. First attempt put `read_at: hb`
        # beside the digest, and step 3 immediately refused on it: a per-generation clock
        # reading can never survive a re-filing, so that one field would have broken every
        # future step 3 on this card. Same class as the `ops_porcelain` fragility already
        # fixed here - a stream field that moves on its own cannot be re-filed. The NAME
        # already carries the state ("at_read"); the clock belongs with the other volatile
        # values. Widening ALLOWED_SUFFIX to admit it was the other option and is wrong:
        # that is the coordinator's gate, and loosening a gate to fit my field inverts it.
        "sha256_at_ops_head": m["card_head"],
        "revisions_agree": m["card_file"] == m["card_head"],
        "ops_head": m["ops_head"],
        "card_porcelain": m["card_porcelain"],
        "card_porcelain_note": ("status of THIS CARD only. The whole ops tree is the manager's "
            "working area and moves on his keystrokes; a stream field that does that cannot "
            "survive a step-3 re-filing. The volatile tree reading is in `submission`."),
      },
      "baseline_provenance": {
        "live_main": m["live_main"],
        "cached_origin_main": m["cached_main"],
        "cache_is_fresh": m["live_main"] == m["cached_main"],
        "note": ("Live main is read by object; the checkout is not moved. The hook routes "
                 "merge-base(origin/main)..head for a new branch, so fetch origin main before "
                 "the first push and re-measure the route then."),
      },
      "surfaces": s,
      "resource_identities": {},
      "evidence_files": evidence,
    }
    for k, v in (content or {}).items():
        stream[k] = v

    # EVERY structured {path, bare sha256} pair is recomputed FROM DISK here, in the same call
    # that computes evidence_files - so one bundle can never carry two different digests for one
    # path. This is not hypothetical: content-s7-harness.json was authored at 20:59:05 and the
    # driver was edited at 21:05:14, so `driver.sha256` named the PREVIOUS driver while
    # `evidence_files[0].sha256` named the current one. The gate reads evidence_files and not
    # `driver`, so a certificate would have bound an input carrying one sha to terminal evidence
    # carrying another - the driver self-hashes into both ACK documents - and the stage would have
    # been certified against a sha that never executed.
    # Only BARE `sha256`/`sha` are reconciled. A QUALIFIED name (sha256_at_ops_head, sha256_file_at_read,
    # *_expected, *_post) deliberately describes a DIFFERENT state of the file and must not be
    # overwritten with the live value.
    corrections = []
    def reconcile(node, where):
        if isinstance(node, dict):
            path = node.get("path")
            if isinstance(path, str) and os.path.isabs(path) and os.path.isfile(path):
                for key in ("sha256", "sha"):
                    if key in node:
                        live = sha_path(path)
                        if node[key] != live:
                            corrections.append((where + "." + key, path, node[key], live))
                        node[key] = live
            for k2, v2 in node.items():
                reconcile(v2, where + "." + k2)
        elif isinstance(node, list):
            for i, v2 in enumerate(node):
                reconcile(v2, "%s[%d]" % (where, i))
    # the driver's digest is SUPPLIED here rather than copied from the content file, so the
    # content declares the path and the prose and never carries a number that can go stale.
    drv = stream.get("driver")
    if isinstance(drv, dict) and isinstance(drv.get("path"), str) and os.path.isfile(drv["path"]):
        was = drv.get("sha256")
        drv["sha256"] = sha_path(drv["path"])
        if was is not None and was != drv["sha256"]:
            corrections.append(("streams[0].driver.sha256", drv["path"], was, drv["sha256"]))
    reconcile(stream, "streams[0]")
    if corrections:
        print("RECONCILED against disk - the content file carried a stale digest:", file=sys.stderr)
        for field, path, was, now in corrections:
            print("   %s\n     path %s\n     was  %s\n     now  %s" % (field, path, was, now),
                  file=sys.stderr)
    bundle = {
      "coordinator_instance": m["coord_instance"],
      "coordinator_epoch": m["coord_epoch"],
      "pilot_card": m["card_abs"],
      "inventory_complete": True,
      "heartbeat_max_seconds": 300,
      "requested_stream_id": "crewing/898-client-slice",
      "streams": [stream],
      # Top-level object, per the schema. Values that move on their own live HERE,
      # because `submission` is the only subtree step 3 may change.
      "submission": {
        "version": "v1",
        "mode": mode,
        "note": ("Step 1 of two: read the content without spending a window."
                 if mode == "review-only" else
                 "Step 3: only event_id, heartbeat and this subtree differ from the reviewed step 1."),
        "coordinator_instance_read_at": hb,
        "card_read_at": hb,
        "coordinator_instance_source": "reports/coordination-state.json; confirm against the coordinator's live word",
        "ops_tree_porcelain_at_build": m["ops_porcelain_volatile"],
        "content_file": content_file_recorded,
          # Coordinator review of 3c step 1, finding 3: the executable code is pinned in
          # streams[0].driver.*, but the file the reviewer's READING rests on was not, so the
          # basis of that reading could change silently. Pinned here inside `submission` -- the
          # one subtree step 3 may legally move -- so adding it never costs a re-review.
        "content_file_sha256": (
            hashlib.sha256(open(content_file_recorded, "rb").read()).hexdigest()
            if content_file_recorded and os.path.isfile(content_file_recorded)
            else "<descriptive only: no content file was read>"),
      },
    }
    return bundle, event_id, hb

ALLOWED_SUFFIX = {"event_id","heartbeat","heartbeat_note"}

def diff_paths(a, b, path=()):
    """Every path where two bundles differ."""
    out = []
    if type(a) is not type(b):
        return [path]
    if isinstance(a, dict):
        for k in set(a) | set(b):
            if k not in a or k not in b: out.append(path+(k,))
            else: out += diff_paths(a[k], b[k], path+(k,))
    elif isinstance(a, list):
        if len(a) != len(b): return [path]
        for i,(x,y) in enumerate(zip(a,b)): out += diff_paths(x,y,path+(str(i),))
    elif a != b:
        out.append(path)
    return out

def main():
    if len(sys.argv) < 2: print(__doc__); return 2
    cmd = sys.argv[1]
    now = datetime.now(timezone.utc).replace(microsecond=0)
    m = measure()
    if not m["coord_instance"]:
        print("REFUSING: coordinator instance unreadable - a value I did not measure "
              "must not be interpolated into a request", file=sys.stderr)
        return 3

    if cmd == "new":
        if len(sys.argv) < 5 or sys.argv[2] not in STAGES or sys.argv[4] not in {"review-only","grant"}:
            print(__doc__); return 2
        stage, label, mode = sys.argv[2], sys.argv[3], sys.argv[4]
        files, contentfile = [], None
        for i,a in enumerate(sys.argv):
            if a == "--files" and i+1 < len(sys.argv):
                files = [os.path.abspath(p) for p in sys.argv[i+1].split(",") if p]
            if a == "--content" and i+1 < len(sys.argv):
                # ABSOLUTE: preflight_pins.py hashes every absolute path named in the bundle and
                # blocks any 64-hex that matches none of them. A relative path is never hashed, so
                # content_file_sha256 read as "a second number for the same object" - his checker
                # was right and the defect was the path form.
                contentfile = os.path.abspath(sys.argv[i+1])
        content = load_content(contentfile)
        bundle, event_id, hb = build(stage, label, mode, files, m, now, content, contentfile)
        name = "%s-%s-%s-%s.json" % (stage, label, mode, now.strftime("%Y%m%dT%H%M%SZ"))
    elif cmd == "step3":
        src = sys.argv[2]
        prev = json.load(open(src))
        stream0 = prev["streams"][0]
        stage, label = stream0["stage"], stream0["event_id"].split("-")[3]
        files = [e["path"] for e in stream0.get("evidence_files", [])]
        cf = prev.get("submission", {}).get("content_file")
        bundle, event_id, hb = build(stage, label, "grant", files, m, now, load_content(cf), cf)
        # Self-check: nothing outside the allowed paths may have moved.
        bad = [p for p in diff_paths(prev, bundle)
               if p and p[0] != "submission" and p[-1] not in ALLOWED_SUFFIX]
        if bad:
            print("REFUSING step 3: these paths moved since the reviewed step 1 -", file=sys.stderr)
            for p in sorted(bad): print("   " + ".".join(p), file=sys.stderr)
            print("Re-review is required; preflight_step3 would reject this.", file=sys.stderr)
            return 5
        name = "%s-%s-grant-%s.json" % (stage, label, now.strftime("%Y%m%dT%H%M%SZ"))
    else:
        print(__doc__); return 2

    path = os.path.join(OUT, name)
    with open(path,"w") as f: json.dump(bundle, f, ensure_ascii=False, indent=2)
    print("path: " + path)
    print("canonical_input_sha256: " + canonical(bundle))
    print("file_bytes_sha256: " + sha_path(path))
    print("event_id: " + event_id + "   heartbeat: " + hb + "   mode: " + bundle["submission"]["mode"])
    print("coordinator: %s  epoch %s  (read now; confirm against his live word)"
          % (m["coord_instance"], m["coord_epoch"]))
    print("repo HEAD %s   live main %s   cache fresh %s"
          % (m["head"], m["live_main"], m["live_main"] == m["cached_main"]))
    print("card %s (file) / %s (HEAD)  agree %s"
          % (m["card_file"], m["card_head"], m["card_file"] == m["card_head"]))
    print("evidence_files: %d" % len(bundle["streams"][0]["evidence_files"]))
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
