import { applyPatch } from 'diff';

const source = `function add(a, b) {
  return a + b;
}`;

const patch = `--- a.js
+++ b.js
@@ -1,3 +1,3 @@
 function add(a, b) {
-  return a + b;
+  return a + b + 0;
 }`;

const patched = applyPatch(source, patch);
console.log("Patched:");
console.log(patched);
