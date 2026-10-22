import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const keyPattern = new RegExp('AI' + 'za[0-9A-Za-z_-]{35}');
for (const root of ['src', 'dist', 'supabase/functions', 'scripts']) {
  if (!fs.existsSync(root)) continue;
  const visit = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(file);
      else if (/\.(tsx?|jsx?|mjs|json|html|map)$/.test(file)) {
        const content = fs.readFileSync(file, 'utf8');
        assert.equal(keyPattern.test(content), false, `Google credential detected in ${file}; value suppressed`);
        if (root === 'src' || root === 'dist') {
          assert.equal(/VITE_GOOGLE_ROUTES_API_KEY|GOOGLE_ROUTES_API_KEY|X-Goog-Api-Key/.test(content), false,
            `Server credential boundary violated in ${file}`);
        }
      }
    }
  };
  visit(root);
}
console.log('Google secret boundary: source and built assets PASS; credential values suppressed.');
