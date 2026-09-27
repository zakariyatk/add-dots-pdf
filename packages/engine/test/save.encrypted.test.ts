import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PDFDocument } from 'pdf-lib';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildPdf, createTextMeasurer, EncryptedSourceError, type PageItem, type SaveHooks } from '../src';

/* encrypted-open.pdf opens without a password but is encrypted (AES-128,
   owner password only); encrypted-password.pdf needs "secret". Both hold one
   page reading "Protected page text", made with pdf-lib and encrypted with
   pypdf. pdf-lib cannot decrypt: copying their pages used to save them blank,
   without an error. */
const fixture = (name: string) =>
  new Uint8Array(readFileSync(fileURLToPath(new URL('./fixtures/' + name, import.meta.url))));
const page = (bytes: Uint8Array, name: string): PageItem => ({
  src: { id: name, bytes, name },
  num: 1,
  rot: 0,
  shapes: [],
});

let hooks: SaveHooks;
beforeAll(async () => {
  hooks = { measure: await createTextMeasurer() };
});

describe('saving an encrypted source', () => {
  it.each(['encrypted-open.pdf', 'encrypted-password.pdf'])(
    '%s stops with EncryptedSourceError',
    async (name) => {
      const err = await buildPdf([page(fixture(name), name)], null, {}, hooks).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(EncryptedSourceError);
      expect((err as Error).name).toBe('EncryptedSourceError');
      expect((err as Error).message).toContain(name);
    },
  );

  it('an unencrypted source still saves', async () => {
    const d = await PDFDocument.create();
    d.addPage([595, 842]);
    const out = await buildPdf([page(await d.save(), 'plain.pdf')], null, {}, hooks);
    expect((await PDFDocument.load(out)).getPageCount()).toBe(1);
  });
});
