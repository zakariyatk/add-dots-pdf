/* The editable PDF: a real PDF that also carries the whole document as it is
   being worked on, so it opens again here ready to edit, as Illustrator's own
   PDFs do.

   Any reader shows its pages (the source pages with the marks painted on,
   only what lies on each artboard). Inside it, out of every reader's way, is
   the document itself: a private stream the catalog points to (/AddDotsProject)
   holding the project as JSON (every mark with all its properties, the page
   order, turns and crops, the layers, the pins, the workspace), and each
   source PDF the pages come from, untouched, in a stream of its own. Opening
   it restores the document from that, never from the painted pages, so
   nothing is lost to flattening.

   The streams are never put inside an object stream, so their dictionaries
   stand in the file as plain text: a scan for the marker tells a project
   from a plain PDF without parsing it (hasProjectMarker). */

import {
  PDFArray,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFString,
  PDFHexString,
  decodePDFRawStream,
} from 'pdf-lib';

export const PROJECT_KEY = 'AddDotsProject';
export const PROJECT_VERSION = 1;

/** What an editable PDF carries: the project as JSON, and the sources by id. */
export interface ProjectEmbed {
  json: string;
  sources: { id: string | number; bytes: Uint8Array; name?: string }[];
}

/** Writes the project into `out` (before it is saved). */
export function attachProject(out: PDFDocument, p: ProjectEmbed): void {
  const ctx = out.context;
  const refs = p.sources.map((s) =>
    ctx.register(
      ctx.stream(s.bytes, {
        Type: 'AddDotsSource',
        SrcId: PDFString.of(String(s.id)),
        ...(s.name ? { Name: PDFHexString.fromText(s.name) } : {}),
      }),
    ),
  );
  const data = ctx.flateStream(new TextEncoder().encode(p.json), {
    Type: PROJECT_KEY,
    Version: PROJECT_VERSION,
    Sources: ctx.obj(refs),
  });
  out.catalog.set(PDFName.of(PROJECT_KEY), ctx.register(data));
}

const MARK = new TextEncoder().encode('/' + PROJECT_KEY);

/** Whether these bytes carry a project, without parsing them. */
export function hasProjectMarker(bytes: Uint8Array): boolean {
  const n = MARK.length,
    first = MARK[0]!;
  for (let i = bytes.indexOf(first); i >= 0 && i <= bytes.length - n; i = bytes.indexOf(first, i + 1)) {
    let k = 1;
    while (k < n && bytes[i + k] === MARK[k]) k++;
    if (k === n) return true;
  }
  return false;
}

/** The project an editable PDF carries, with its sources by id, or null when
    it carries none (or it cannot be read: it then opens as a plain PDF). */
export async function readProject(bytes: Uint8Array): Promise<{
  data: Record<string, unknown>;
  sources: Map<string, { bytes: Uint8Array; name: string | null }>;
} | null> {
  if (!hasProjectMarker(bytes)) return null;
  try {
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    const ref = doc.catalog.get(PDFName.of(PROJECT_KEY));
    const st = ref ? doc.context.lookup(ref) : null;
    if (!(st instanceof PDFRawStream)) return null;
    const json = new TextDecoder().decode(decodePDFRawStream(st).decode());
    const data = JSON.parse(json) as Record<string, unknown>;
    if (!data || typeof data !== 'object') return null;
    const sources = new Map<string, { bytes: Uint8Array; name: string | null }>();
    const list = st.dict.lookup(PDFName.of('Sources'));
    if (list instanceof PDFArray) {
      for (let i = 0; i < list.size(); i++) {
        const s = list.lookup(i);
        if (!(s instanceof PDFRawStream)) continue;
        const id = s.dict.lookup(PDFName.of('SrcId'));
        const nm = s.dict.lookup(PDFName.of('Name'));
        if (!(id instanceof PDFString || id instanceof PDFHexString)) continue;
        sources.set(id.decodeText(), {
          bytes: decodePDFRawStream(s).decode(),
          name: nm instanceof PDFString || nm instanceof PDFHexString ? nm.decodeText() : null,
        });
      }
    }
    return { data, sources };
  } catch {
    return null;
  }
}
