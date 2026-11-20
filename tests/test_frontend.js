const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "app", "static", "app.js"), "utf8");

function extractFunction(name) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start === -1) throw new Error(`Could not find ${name} in app.js`);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`Could not parse ${name} in app.js`);
}

for (const name of ["pascalIconName", "resolveIconName", "safeHttpUrl", "reorderIds"]) {
  eval(extractFunction(name));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const aliases = { vercel: "triangle" };
const library = { Link: [], Triangle: [] };
assert(resolveIconName("vercel", aliases, library) === "triangle", "known alias should resolve");
assert(resolveIconName("__proto__", {}, library) === "link", "prototype key must not crash or resolve");
assert(resolveIconName("constructor", {}, library) === "link", "inherited key must not resolve");

assert(safeHttpUrl("https://example.com/path") === "https://example.com/path", "HTTPS URL should pass");
assert(safeHttpUrl("http://example.com") === "http://example.com", "HTTP URL should pass");
assert(safeHttpUrl("javascript:alert(1)") === "", "javascript URL should fail");
assert(safeHttpUrl("data:text/html,bad") === "", "data URL should fail");
assert(safeHttpUrl("https://user:password@example.com") === "", "credential URL should fail");
assert(safeHttpUrl("https://example.com/\njavascript:alert(1)") === "", "control character URL should fail");

assert(
  JSON.stringify(reorderIds(["A", "B", "C"], "A", "B")) === JSON.stringify(["B", "A", "C"]),
  "dragging downward should take the target position",
);
assert(
  JSON.stringify(reorderIds(["A", "hidden", "B", "C"], "A", "B")) === JSON.stringify(["hidden", "B", "A", "C"]),
  "filtered reorder should not append hidden links to the end",
);
assert(
  JSON.stringify(reorderIds(["A", "B"], "missing", "B")) === JSON.stringify(["A", "B"]),
  "unknown drag id should leave order unchanged",
);

console.log("frontend helper tests passed");
