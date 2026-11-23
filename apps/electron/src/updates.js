/* Updates of the Microsoft Store package (main.js store_update): which
   version the Store's catalog offers, and whether it is newer than this
   one. Apart from Electron, so test/updates.test.js can test it in Node. */
'use strict';

/* the highest version among the catalog's packages of this identity */
function latestInCatalog(data, identity) {
  const re = new RegExp('^' + identity.replace(/\./g, '\\.') + '_(\\d+(?:\\.\\d+){1,3})_', 'i');
  let best = null;
  const products = data && Array.isArray(data.Products) ? data.Products : [];
  for (const p of products) {
    for (const a of (p && p.DisplaySkuAvailabilities) || []) {
      const pkgs = (a && a.Sku && a.Sku.Properties && a.Sku.Properties.Packages) || [];
      for (const k of pkgs) {
        const m = re.exec(String((k && k.PackageFullName) || ''));
        if (m && (!best || newerVersion(m[1], best))) best = m[1];
      }
    }
  }
  return best;
}
/* a.b.c[.d] newer than the other, missing parts as 0 */
function newerVersion(a, b) {
  const x = String(a).split('.').map(Number),
    y = String(b).split('.').map(Number);
  for (let i = 0; i < 4; i++) {
    const d = (x[i] || 0) - (y[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

module.exports = { latestInCatalog, newerVersion };
