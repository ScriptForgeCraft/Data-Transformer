// Fix import paths: add .js extensions for Vite compatibility
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "src", "excel");
const files = fs.readdirSync(dir).filter(f => f.endsWith(".js"));

for (const file of files) {
    const fp = path.join(dir, file);
    let content = fs.readFileSync(fp, "utf8");
    // Add .js to relative imports that don't have it
    content = content.replace(/from "(\.\/[^"]+?)(?<!\.js)";/g, 'from "$1.js";');
    fs.writeFileSync(fp, content, "utf8");
    console.log(`Fixed imports in: ${file}`);
}
console.log("Done fixing imports!");
