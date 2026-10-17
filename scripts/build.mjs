import { build } from 'esbuild';
await build({ entryPoints: ['source/main.ts'], bundle: true, format: 'esm', target: 'es2022', outfile: 'app/assets/steadypath.js', minify: true, sourcemap: true, define: { 'import.meta.env.PROD': 'true' } });
