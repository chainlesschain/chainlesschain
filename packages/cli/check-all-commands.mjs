import { readFileSync } from 'fs';
import { join } from 'path';

const manifest = JSON.parse(readFileSync(join(process.cwd(), 'src/command-manifest.json'), 'utf8'));

const errors = [];
const loaded = [];

for (const entry of manifest.commands) {
  try {
    const modulePath = join(process.cwd(), 'src', entry.module.replace('./', ''));
    const mod = await import(modulePath);
    if (typeof mod[entry.register] !== 'function') {
      errors.push(`${entry.name}: register function '${entry.register}' not found. Exports: ${Object.keys(mod).join(', ')}`);
    } else {
      loaded.push(entry.name);
    }
  } catch (err) {
    errors.push(`${entry.name}: ${err.message}`);
  }
}

console.log(`Successfully loaded: ${loaded.length}/${manifest.commands.length}`);
console.log('\nErrors:');
errors.forEach((e, i) => console.log(`${i+1}. ${e}`));
