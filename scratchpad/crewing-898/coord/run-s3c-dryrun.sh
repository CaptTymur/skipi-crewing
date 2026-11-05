#!/usr/bin/env bash
# (в) for sub-stage 3c: measure the Rust cost and the in-tree write surface on a COPY,
# with CARGO_TARGET_DIR outside the vehicle. OUTSIDE ANY WINDOW. Touches neither the
# vehicle nor the canonical checkout.
set -uo pipefail

W=/home/linux/Developer/worktrees/crewing-898-20261104
CANON=/home/linux/Developer/skipi-crewing
DRY=${DRY:-/tmp/claude-1000/-home-linux-Developer-skipi-crewing/ebbd1815-b6d4-4272-b07f-4adc865ecf49/scratchpad/s3c-dryrun}
COPY=$DRY/copy
TGT=$DRY/cargo-target
OUT=$DRY/out
mkdir -p "$OUT"

say() { printf '%s\n' "$*" | tee -a "$OUT/driver.txt"; }

say "=== (в) 3c DRY RUN  started $(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
say "umask=$(umask)   DRY=$DRY"
say "cargo: $(cargo --version 2>&1)"
say "rustc: $(rustc --version 2>&1)"

# -- gate 0: refuse if the target dir would land inside either repo ---------------
case "$TGT" in
  "$W"/*|"$CANON"/*) say "REFUSE: CARGO_TARGET_DIR inside a repo: $TGT"; exit 7;;
esac
case "$COPY" in
  "$W"/*|"$CANON"/*) say "REFUSE: copy inside a repo: $COPY"; exit 7;;
esac
say "gate0 OK: target and copy both outside $W and $CANON"

# -- gate 1: record the vehicle PRE state by the CORRECTED predicate --------------
PRE_TRACKED=$(git -C "$W" status --porcelain | wc -l)
git -C "$W" status --porcelain > "$OUT/vehicle-pre.txt"
PRE_HEAD=$(git -C "$W" rev-parse HEAD)
CANON_HEAD=$(git -C "$CANON" rev-parse HEAD)
CANON_TRACKED=$(git -C "$CANON" status --porcelain | grep -v '^?? scratchpad/$' | wc -l)
say "gate1: vehicle tracked-changed=$PRE_TRACKED head=${PRE_HEAD:0:8}  canonical head=${CANON_HEAD:0:8} tracked-changed(sans scratchpad)=$CANON_TRACKED"
[ "$PRE_TRACKED" = "2" ] || { say "REFUSE: expected exactly 2 modified tracked files in the vehicle, got $PRE_TRACKED"; exit 7; }

# -- build the copy --------------------------------------------------------------
rm -rf "$COPY"; mkdir -p "$COPY"
tar -C "$W" -cf - --exclude='src-tauri/target' src-tauri dist .cargo 2>/dev/null | tar -C "$COPY" -xf -
say "copy built: $(du -sh "$COPY" | cut -f1)  files=$(find "$COPY" -type f | wc -l)"
say "copy carries .cargo/config.toml: $([ -f "$COPY/.cargo/config.toml" ] && echo yes || echo NO)"
say "copy has a .git: $([ -e "$COPY/.git" ] && echo yes || echo 'no — so ../.git/HEAD is missing here too')"

# -- manifest BEFORE (path, mode, sha256) ----------------------------------------
manifest() {
  (cd "$COPY" && find . -type f -printf '%m %p\n' | sort | while read -r m p; do
     printf '%s %s %s\n' "$m" "$(sha256sum "$p" | cut -c1-16)" "$p"; done)
}
manifest > "$OUT/tree-before.txt"
say "manifest BEFORE: $(wc -l < "$OUT/tree-before.txt") files"

# -- run 1: COLD cargo test --lib ------------------------------------------------
rm -rf "$TGT"; mkdir -p "$TGT"
export CARGO_TARGET_DIR="$TGT"
say ""
say "--- run 1: COLD  cargo test --lib --offline ---"
S=$(date +%s.%N)
( cd "$COPY/src-tauri" && timeout 2400 cargo test --lib --offline ) > "$OUT/cold.log" 2>&1
RC1=$?; E=$(date +%s.%N)
T1=$(echo "$E - $S" | bc)
say "run1 exit=$RC1 wall=${T1}s"
say "run1 Compiling units: $(grep -c '^   Compiling' "$OUT/cold.log")"
say "run1 target size: $(du -sh "$TGT" 2>/dev/null | cut -f1)"
grep -E '^test result:' "$OUT/cold.log" | sed 's/^/  /' | tee -a "$OUT/driver.txt"
grep -E '^error(\[|:)' "$OUT/cold.log" | head -5 | sed 's/^/  ERR /' | tee -a "$OUT/driver.txt"

# -- manifest AFTER: what did the build write INSIDE the tree? -------------------
manifest > "$OUT/tree-after.txt"
say ""
say "--- in-tree writes by the build (the declaration's real subject) ---"
diff "$OUT/tree-before.txt" "$OUT/tree-after.txt" > "$OUT/tree-diff.txt"
if [ -s "$OUT/tree-diff.txt" ]; then
  say "tree CHANGED. created/modified paths:"
  grep '^>' "$OUT/tree-diff.txt" | awk '{print $4}' | sed 's/^/  + /' | tee -a "$OUT/driver.txt"
  grep '^<' "$OUT/tree-diff.txt" | awk '{print $4}' | sed 's/^/  - /' | tee -a "$OUT/driver.txt"
  say ""
  say "and whether each is TRACKED in the vehicle (tracked => visible to my PRE/POST predicate):"
  grep '^>' "$OUT/tree-diff.txt" | awk '{print $4}' | sed 's|^\./||' | sort -u | while read -r p; do
    if git -C "$W" ls-files --error-unmatch "$p" >/dev/null 2>&1; then t=TRACKED; else
      if git -C "$W" check-ignore -q "$p" 2>/dev/null; then t="ignored"; else t="untracked-not-ignored"; fi; fi
    printf '  %-26s %s\n' "$t" "$p" | tee -a "$OUT/driver.txt"
  done
else
  say "tree UNCHANGED — the build wrote nothing inside the source tree"
fi

# -- run 2: WARM repeat, no edit -------------------------------------------------
say ""
say "--- run 2: WARM repeat, no edit ---"
S=$(date +%s.%N)
( cd "$COPY/src-tauri" && timeout 900 cargo test --lib --offline -v ) > "$OUT/warm.log" 2>&1
RC2=$?; E=$(date +%s.%N); T2=$(echo "$E - $S" | bc)
say "run2 exit=$RC2 wall=${T2}s  Dirty=$(grep -c '^       Dirty' "$OUT/warm.log")  Fresh=$(grep -c '^       Fresh' "$OUT/warm.log")"
grep '^       Dirty' "$OUT/warm.log" | head -5 | sed 's/^/  /' | tee -a "$OUT/driver.txt"

# -- run 3: WARM after touching native_lifecycle.rs (the realistic 3c edit) ------
say ""
say "--- run 3: WARM after editing native_lifecycle.rs (sizes the real 3c re-run) ---"
printf '\n// dry-run probe %s\n' "$(date -u +%s)" >> "$COPY/src-tauri/src/native_lifecycle.rs"
S=$(date +%s.%N)
( cd "$COPY/src-tauri" && timeout 900 cargo test --lib --offline ) > "$OUT/edit.log" 2>&1
RC3=$?; E=$(date +%s.%N); T3=$(echo "$E - $S" | bc)
say "run3 exit=$RC3 wall=${T3}s  Compiling=$(grep -c '^   Compiling' "$OUT/edit.log")"
grep -E '^test result:' "$OUT/edit.log" | sed 's/^/  /' | tee -a "$OUT/driver.txt"

# -- baseline test inventory: WHICH tests fail before any product change ---------
say ""
say "--- baseline: failing test names (umask=$(umask); memory says 15 reds are umask-dependent) ---"
grep -E '^test .* FAILED$' "$OUT/cold.log" | sed 's/^/  /' | tee -a "$OUT/driver.txt"
say "failing count (cold): $(grep -cE '^test .* FAILED$' "$OUT/cold.log")"

# -- final: prove the vehicle and canonical never moved --------------------------
say ""
say "=== POST: did anything move outside the copy? ==="
POST_TRACKED=$(git -C "$W" status --porcelain | wc -l)
POST_HEAD=$(git -C "$W" rev-parse HEAD)
CANON_HEAD2=$(git -C "$CANON" rev-parse HEAD)
say "vehicle tracked-changed $PRE_TRACKED -> $POST_TRACKED ; head ${PRE_HEAD:0:8} -> ${POST_HEAD:0:8}"
say "canonical head ${CANON_HEAD:0:8} -> ${CANON_HEAD2:0:8}"
say "vehicle gen/schemas exists? $([ -d "$W/src-tauri/gen/schemas" ] && echo 'YES — unexpected' || echo 'no')"
say "vehicle target exists?      $([ -d "$W/src-tauri/target" ] && echo 'YES — unexpected' || echo 'no')"
say "final target dir size: $(du -sh "$TGT" 2>/dev/null | cut -f1)"
say "=== (в) finished $(date -u +%Y-%m-%dT%H:%M:%SZ)  rc: cold=$RC1 warm=$RC2 edit=$RC3 ==="
