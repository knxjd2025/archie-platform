// Placeholder so Vercel finds the function before building.
// `npm run build` replaces this file with the bundled server (esbuild api/index.ts).
module.exports = (_req, res) => { res.statusCode = 503; res.end('Archie was deployed without running the build.'); };
