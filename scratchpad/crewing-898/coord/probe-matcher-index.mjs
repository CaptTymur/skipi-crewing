import fs from "fs";
const target = process.argv[2];
const html = fs.readFileSync(target, "utf8");
const siAt = html.indexOf("var SETTINGS_I18N");
// (1) the OLD IIFE, verbatim from the pre-patch harness
const oldEnd = (() => { let b = html.indexOf("{", siAt), d = 0, i = b;
  for (; i < html.length; i++) { if (html[i] === "{") d++; else if (html[i] === "}") { d--; if (d === 0) break; } }
  return i; })();
// (2) balancedEnd, extracted from the harness's own bytes
const src = fs.readFileSync(process.argv[3], "utf8");
const fn = src.match(/function balancedEnd[\s\S]*?\n\}/)[0];
const balancedEnd = new Function(fn + "; return balancedEnd;")();
const newEnd = balancedEnd(html, html.indexOf("{", siAt) + 1, "{", "}", '"');
console.log("  file           :", target);
console.log("  file sha256    :", (await import("crypto")).createHash("sha256").update(fs.readFileSync(target)).digest("hex"));
console.log("  old IIFE end   :", oldEnd, " char at that index:", JSON.stringify(html[oldEnd]));
console.log("  balancedEnd    :", newEnd, " char at that index:", JSON.stringify(html[newEnd]));
console.log("  equal          :", oldEnd === newEnd);
// Usage: node coord/probe-matcher-index.mjs <dist/index.html> <harness.mjs>
// Prints the end index from BOTH the old IIFE and balancedEnd (extracted from the harness's
// own bytes), the file's sha256, and the character at the index - so the number is
// reproducible by a third reader rather than taken on report.
