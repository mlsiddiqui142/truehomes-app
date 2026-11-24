const fs = require('fs');
let c = fs.readFileSync('test-interfaces.js', 'utf8');

// Replace { restaurants } destructuring with direct array usage (since /api/restaurants returns plain array)
c = c.replace(
  /const \{ restaurants \} = await restRes\.json\(\);\n(\s*)const rest = restaurants\[0\];/g,
  'const restaurants = await restRes.json();\n$1const rest = restaurants[0];'
);

// Also fix for kitchens in Phase 4 tests that now destructure
// (Check both patterns)
console.log('Remaining { restaurants }:', (c.match(/const \{ restaurants \}/g) || []).length);

fs.writeFileSync('test-interfaces.js', c, 'utf8');
console.log('Done');
