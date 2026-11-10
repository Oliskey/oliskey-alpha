// Adds what search engines and link previews read to a finished web build: title, description, canonical address, share card,
// structured data, a readable page for anything that does not run JavaScript, robots.txt and sitemap.xml. Run on every build.
// The wording stays honest: demo credits, and no promise of profit. The main address is the owner's domain: the same app at its other addresses
// tells search engines to list this one instead. GOOGLE_SITE_VERIFICATION, when set, adds Search Console's ownership tag (a public code, not a secret).
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SITE = (process.env.SITE_URL || 'https://alpha.oliskey.com').replace(/\/$/, '');
const VERIFY = (process.env.GOOGLE_SITE_VERIFICATION || '').replace(/[^A-Za-z0-9_-]/g, '');
const NAME = 'Oliskey Alpha';
const TITLE = 'Oliskey Alpha: practice trading with demo credits and live crypto prices';
const DESCRIPTION = 'Learn to trade with Oliskey Alpha. Practise Fixed Time, InZone and Forex trades with demo credits on live crypto prices, follow an AI that shows its real record, and study free lessons. Trading can lose money.';
const PATHS = ['/', '/welcome', '/login', '/register', '/terms', '/privacy'];

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// The maker is the same organisation, with the same @id, that www.oliskey.com describes: search engines then connect this app
// to the main website, and the main website's product page (MAIN_PAGE) to this app.
const MAIN = 'https://www.oliskey.com';
const MAIN_PAGE = `${MAIN}/trading-app`;
const ORG = { '@id': `${MAIN}/#organization` };
function structuredData() {
  return [
    { '@context': 'https://schema.org', '@type': 'Organization', '@id': ORG['@id'], name: 'Oliskey', legalName: 'Oliskeylee Ltd', url: MAIN },
    { '@context': 'https://schema.org', '@type': 'WebSite', name: NAME, url: SITE, description: DESCRIPTION, publisher: ORG },
    {
      '@context': 'https://schema.org', '@type': 'SoftwareApplication', '@id': `${MAIN}/#product-alpha`, name: NAME, url: SITE, applicationCategory: 'EducationalApplication',
      operatingSystem: 'Web, Android, iOS', description: DESCRIPTION, image: `${SITE}/og-image.png`, offers: { '@type': 'Offer', price: '0', priceCurrency: 'NGN' },
      publisher: ORG, sameAs: [MAIN_PAGE],
    },
  ];
}

const HEAD = () => `
<meta name="description" content="${esc(DESCRIPTION)}">
<meta name="application-name" content="${NAME}">
<meta name="apple-mobile-web-app-title" content="${NAME}">
<meta name="theme-color" content="#000000">
<meta name="robots" content="index, follow, max-image-preview:large">${VERIFY ? `\n<meta name="google-site-verification" content="${VERIFY}">` : ''}
<link rel="canonical" href="${SITE}/">
<meta name="author" content="Oliskey">
<link rel="author" href="${MAIN}/">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="/icon-192.png">
<link rel="apple-touch-icon" href="/icon-512.png">
<meta property="og:type" content="website">
<meta property="og:site_name" content="${NAME}">
<meta property="og:title" content="${esc(TITLE)}">
<meta property="og:description" content="${esc(DESCRIPTION)}">
<meta property="og:url" content="${SITE}/">
<meta property="og:image" content="${SITE}/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="${NAME} logo and name on a black background">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(TITLE)}">
<meta name="twitter:description" content="${esc(DESCRIPTION)}">
<meta name="twitter:image" content="${SITE}/og-image.png">
${structuredData().map((d) => `<script type="application/ld+json">${JSON.stringify(d).replace(/</g, '\\u003c')}</script>`).join('\n')}
<!-- seo-applied -->
`;

const BODY = `
<noscript>
<main style="max-width:640px;margin:0 auto;padding:32px 16px;font-family:system-ui,sans-serif;color:#f2f2f2;background:#000">
<h1>${NAME}</h1>
<p>${esc(DESCRIPTION)}</p>
<h2>What you can do</h2>
<ul>
<li>Practise Fixed Time, InZone and Forex trades with demo credits.</li>
<li>Follow live crypto prices and read charts with drawing tools and indicators.</li>
<li>See an AI trade on demo credits, with its full record, wins and losses.</li>
<li>Learn from free lessons on trading and risk.</li>
</ul>
<p>Demo credits have no cash value. Trading can lose money, and past results do not promise future ones. This is not financial advice.</p>
<p>A product by <a href="${MAIN}/" style="color:#3ba4ff">Oliskey</a>. <a href="${MAIN_PAGE}" style="color:#3ba4ff">About Oliskey Alpha</a> · <a href="${MAIN}/products" style="color:#3ba4ff">All Oliskey products</a></p>
<p><a href="/terms" style="color:#3ba4ff">Terms</a> · <a href="/privacy" style="color:#3ba4ff">Privacy</a></p>
<p>Please turn on JavaScript to use the app.</p>
</main>
</noscript>
`;

export function applySeo(dir) {
  const file = path.join(dir, 'index.html');
  let html = readFileSync(file, 'utf8');
  if (html.includes('seo-applied')) return;
  if (!/<html[^>]*\blang=/.test(html)) html = html.replace(/<html/, '<html lang="en"');
  html = /<title>[\s\S]*?<\/title>/.test(html) ? html.replace(/<title>[\s\S]*?<\/title>/, `<title>${esc(TITLE)}</title>`) : html.replace('</head>', `<title>${esc(TITLE)}</title></head>`);
  html = html.replace(/<meta name="description"[^>]*>/g, '').replace('</head>', `${HEAD()}</head>`);
  html = html.includes('<noscript>') ? html.replace(/<noscript>[\s\S]*?<\/noscript>/, BODY) : html.replace(/<body([^>]*)>/, `<body$1>${BODY}`);
  writeFileSync(file, html);
  writeFileSync(path.join(dir, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin\n\nSitemap: ${SITE}/sitemap.xml\n`);
  const today = new Date().toISOString().slice(0, 10);
  writeFileSync(path.join(dir, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PATHS.map((p) => `  <url><loc>${SITE}${p}</loc><lastmod>${today}</lastmod></url>`).join('\n')}\n</urlset>\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  applySeo(path.resolve(process.argv[2]));
  console.log('SEO added');
}
