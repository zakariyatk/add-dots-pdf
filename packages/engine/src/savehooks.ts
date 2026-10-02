/* The hooks every save runs with, built from plain data.

   The feature modules (annotate, draw, forms, insert, leaders, document ops,
   share) each used to plug their painters and prepare/finish steps into
   core's registries. All of those come from this engine; the only things they
   read from the page are a few values, gathered in SaveState. Building the
   hooks here from that data is what lets a save run in a worker, and the page
   uses the same builder, so the two cannot drift apart. */

import type { PDFDocument } from 'pdf-lib';
import type { MeasureText } from './geometry';
import type { Scale } from './measure';
import { DEFAULT_SCALE } from './measure';
import { annotateFontNeeds, annotatePainters } from './painters/annotate';
import { docopsFontNeeds, docopsPainters, docopsPrepare } from './painters/docops';
import { drawFontNeeds, drawPainters } from './painters/draw';
import { fieldsFinish, type FieldValues } from './painters/fields';
import { formsPainters, insertPainters, prepareSignatures, prepareInsert } from './painters/insert';
import { leaderPainters } from './painters/leader';
import { ocrFontNeeds, ocrPainters } from './painters/ocr';
import { pinHooks, type PinLocation } from './pins';
import type { SaveHooks } from './save';
import type { UnicodeFontSource } from './text';

/** Document details written into the saved file (File > Document properties). */
export interface DocMeta {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
}

/** What a save needs from the page, as plain data that can be posted to a worker. */
export interface SaveState {
  /** The drawing scale, for measurement readings. */
  scale?: Scale | null;
  /** Form field values, by field. */
  values?: FieldValues | null;
  meta?: DocMeta | null;
  /** For headers and footers: {pages}, {file} and {date}. */
  totalPages?: number;
  fileName?: string;
  today?: string;
  /** Photo pin locations. */
  locs?: Record<string, PinLocation> | null;
  /** The document's name, on the photo appendix. */
  docName?: string;
}

export interface SaveEnv {
  measure: MeasureText;
  unicode?: UnicodeFontSource | null;
  /** Let the thread breathe during a long save. */
  breathe?: () => Promise<void>;
}

function metaFinish(meta: DocMeta | null | undefined) {
  return (out: PDFDocument): void => {
    try {
      const m = meta || {};
      if (m.title) out.setTitle(m.title);
      if (m.author) out.setAuthor(m.author);
      if (m.subject) out.setSubject(m.subject);
      if (m.keywords) out.setKeywords(m.keywords.split(/\s*[,;]\s*/).filter(Boolean));
      out.setProducer('ADD DOTS PDF Editor');
      out.setModificationDate(new Date());
    } catch {
      /* details are a nicety: never fail a save over them */
    }
  };
}

/** The hooks a save runs with, in the order the modules used to register them. */
export function saveHooks(state: SaveState, env: SaveEnv): SaveHooks {
  const doc = {
    totalPages: () => state.totalPages || 0,
    fileName: () => state.fileName || '',
    today: () => (state.today != null ? state.today : new Date().toLocaleDateString()),
  };
  const scale = state.scale || DEFAULT_SCALE;
  return {
    measure: env.measure,
    unicode: env.unicode || null,
    fontNeeds: { ...annotateFontNeeds, ...drawFontNeeds, ...docopsFontNeeds, ...ocrFontNeeds },
    shapePainters: {
      ...annotatePainters,
      ...drawPainters(() => scale),
      ...formsPainters,
      ...insertPainters,
      leader: leaderPainters.leader!,
      ...ocrPainters,
      ...docopsPainters(doc),
      /* a mark someone else is still drawing, live: not saved */
      remote: () => {},
    },
    prepare: [prepareSignatures, prepareInsert, docopsPrepare(doc)],
    finish: [fieldsFinish(() => state.values || {}), metaFinish(state.meta)],
    pins: pinHooks(state.locs || {}, {
      docName: () => state.docName || '',
      ...(env.breathe ? { breathe: env.breathe } : {}),
    }),
  };
}
