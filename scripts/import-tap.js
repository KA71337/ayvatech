import { importTap } from '../lib/importer.js';
try { console.log(JSON.stringify(await importTap(), null, 2)); }
catch (error) { console.error(error.message); process.exitCode = 1; }
