const fs = require('fs');
const path = require('path');
const glob = require('tiny-glob'); // No wait, Tiny glob might not be installed globally, I'll just use a recursive function.

function walkDir(dir, callback) {
  fs.readdirSync(dir).forEach(f => {
    let dirPath = path.join(dir, f);
    let isDirectory = fs.statSync(dirPath).isDirectory();
    isDirectory ? walkDir(dirPath, callback) : callback(path.join(dir, f));
  });
}

const replacements = [
  ['OpenRouterMessage', 'StandardMessage'],
  ['OpenRouterToolCall', 'StandardToolCall'],
  ['OpenRouterTool', 'StandardTool'],
  ['OpenRouterStreamChunk', 'StandardStreamChunk'],
  ['OpenRouterResponse', 'StandardResponse'],
];

walkDir('./src', (filePath) => {
  if (filePath.endsWith('.ts') || filePath.endsWith('.tsx')) {
    let content = fs.readFileSync(filePath, 'utf8');
    let original = content;
    
    // Replace names
    for (let [oldName, newName] of replacements) {
      content = content.split(oldName).join(newName);
    }
    
    // Replace imports from openrouter to base-client
    content = content.replace(/import\s+\{([^}]+)\}\s+from\s+['"](?:\.\.\/)+api\/openrouter(?:\.js)?['"]/g, (match, imports) => {
      // If the import contains OpenRouterClient, we have to split it, else just rename the path
      if (imports.includes('OpenRouterClient')) {
        const otherImports = imports.replace(/OpenRouterClient,?\s*/, '').trim();
        let newImport = `import { OpenRouterClient } from "${match.match(/['"](.*?)['"]/)[1]}";\n`;
        if (otherImports) {
            // Need to calculate the relative path to base-client based on the openrouter path
            const openrouterPath = match.match(/['"](.*?)['"]/)[1];
            const baseClientPath = openrouterPath.replace('openrouter', 'base-client');
            newImport += `import { ${otherImports} } from "${baseClientPath}";`;
        }
        return newImport;
      } else {
        const openrouterPath = match.match(/['"](.*?)['"]/)[1];
        const baseClientPath = openrouterPath.replace('openrouter', 'base-client');
        return match.replace(openrouterPath, baseClientPath);
      }
    });

	// Similar for single directory relative imports
	content = content.replace(/import\s+\{([^}]+)\}\s+from\s+['"]\.\/openrouter(?:\.js)?['"]/g, (match, imports) => {
      if (imports.includes('OpenRouterClient')) {
        const otherImports = imports.replace(/OpenRouterClient,?\s*/, '').trim();
        let newImport = `import { OpenRouterClient } from "./openrouter.js";\n`;
        if (otherImports) {
            newImport += `import { ${otherImports} } from "./base-client.js";`;
        }
        return newImport;
      } else {
        return match.replace('./openrouter.js', './base-client.js').replace('./openrouter', './base-client');
      }
    });
    
    if (content !== original) {
      fs.writeFileSync(filePath, content);
      console.log(`Updated ${filePath}`);
    }
  }
});
