/* Test helpers: the Unicode fallback font from disk, and the text of a saved
   PDF as a viewer reads it back (pdf.js, the same reader the app uses). */

import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import fontkit from '@pdf-lib/fontkit';
import type { UnicodeFontSource } from '../../src';

const require = createRequire(import.meta.url);

export const FONT_PATH = require.resolve('dejavu-fonts-ttf/ttf/DejaVuSans.ttf');

export const unicodeSource: UnicodeFontSource = { load: () => ({ fontkit, bytes: readFileSync(FONT_PATH) }) };

type TextItem = { str: string; hasEOL?: boolean };
type PdfJs = {
  getDocument(src: object): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: TextItem[] }> }>;
    }>;
  };
};
const pdfjs = require('pdfjs-dist/legacy/build/pdf.js') as PdfJs;

/** Each page's text, as pdf.js extracts it: the pieces joined, line ends as \n. */
export async function pageTexts(bytes: Uint8Array): Promise<string[]> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), verbosity: 0, isEvalSupported: false })
    .promise;
  const out: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const { items } = await (await doc.getPage(i)).getTextContent();
    out.push(items.map((it) => it.str + (it.hasEOL ? '\n' : '')).join(''));
  }
  return out;
}
