'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { latestInCatalog, newerVersion } = require('../src/updates');

const ID = 'ADDDOTS.ADDDOTSPDF';
function catalog(names) {
  return {
    Products: [
      {
        DisplaySkuAvailabilities: [
          { Sku: { Properties: { Packages: names.map((n) => ({ PackageFullName: n })) } } },
          { Sku: { Properties: {} } },
        ],
      },
    ],
  };
}

test('newerVersion compares part by part, missing parts as 0', () => {
  assert.equal(newerVersion('1.0.120.0', '1.0.119'), true);
  assert.equal(newerVersion('1.0.119.0', '1.0.119'), false);
  assert.equal(newerVersion('1.0.99.0', '1.0.100'), false);
  assert.equal(newerVersion('1.1.0.0', '1.0.400'), true);
  assert.equal(newerVersion('1.0.9', '1.0.10'), false);
});

test('latestInCatalog takes the highest version of this identity only', () => {
  const data = catalog([
    ID + '_1.0.118.0_x64__q2kbk5p8bgx2e',
    ID + '_1.0.121.0_x64__q2kbk5p8bgx2e',
    'OTHER.APP_9.9.9.0_x64__abc',
    ID + 'X_5.0.0.0_x64__abc',
  ]);
  assert.equal(latestInCatalog(data, ID), '1.0.121.0');
});

test('latestInCatalog says nothing for an answer it does not know', () => {
  assert.equal(latestInCatalog(null, ID), null);
  assert.equal(latestInCatalog({}, ID), null);
  assert.equal(latestInCatalog({ Products: [{}] }, ID), null);
  assert.equal(latestInCatalog(catalog(['garbage', 42]), ID), null);
});
