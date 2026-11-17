import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const files = [
  'lib/contracts.js',
  'lib/abi.js',
  'lib/rpc.js',
  'lib/rescue.js',
  'lib/i18n.js',
  'app.js',
];

function stripModuleSyntax(src) {
  let out = src.replace(/^\s*import[\s\S]*?from\s+['"][^'"]+['"];?\s*\n/gm, '');
  out = out.replace(/^export\s+(?=(?:const|let|var|function|async\s+function|class)\b)/gm, '');
  return out.trim();
}

const css = fs.readFileSync(path.join(root, 'style.css'), 'utf8').trim();
const jsBundle = files
  .map(f => `// --- ${f} ---\n` + stripModuleSyntax(fs.readFileSync(path.join(root, f), 'utf8')))
  .join('\n\n');

const template = fs.readFileSync(path.join(root, 'index.template.html'), 'utf8');
const built = template
  .replace('<!-- INLINE_CSS -->', `<style>\n${css}\n  </style>`)
  .replace('<!-- INLINE_JS -->', `<script>\n(() => {\n'use strict';\n\n${jsBundle}\n\n})();\n  </script>`);

fs.writeFileSync(path.join(root, 'index.html'), built, 'utf8');
console.log(`Built standalone index.html (${built.length} bytes)`);
