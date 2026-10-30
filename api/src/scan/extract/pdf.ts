import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { dirname, join } from 'path';
import { pathToFileURL } from 'url';
import { ExtractCancelled } from './types';

const MAX_PDF_PAGES = 30;
const MAX_IMAGE_PAGES_PER_PDF = 8;
const MIN_TEXT_CHARS = 8;
const RENDER_SCALE = 2;
const MAX_RENDER_SIDE = 3200;
const MAX_ANNOTATIONS = 200;
const MAX_ANNOTATION_CHARS = 5000;

class CanvasFactory {
  create(width: number, height: number) {
    const canvas = createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d') };
  }
  reset(pair: any, width: number, height: number) {
    pair.canvas.width = width;
    pair.canvas.height = height;
  }
  destroy(pair: any) {
    pair.canvas.width = 0;
    pair.canvas.height = 0;
    pair.canvas = null;
    pair.context = null;
  }
}

let loaded: any = null;

// The current pdfjs-dist is an ES module. A plain import() would be turned into require() by the compiler, so it is built at run time.
const nativeImport = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<any>;

async function pdfjs(): Promise<any> {
  if (!loaded) {
    const g = globalThis as any;
    g.DOMMatrix ??= DOMMatrix;
    g.Path2D ??= Path2D;
    g.ImageData ??= ImageData;
    loaded = await nativeImport(pathToFileURL(require.resolve('pdfjs-dist/legacy/build/pdf.mjs')).href);
  }
  return loaded;
}

interface PdfPage {
  page: number;
  text: string;
  png?: Buffer;
  annotations?: string;
  notSupported?: boolean;
}

interface PdfRead {
  pages: PdfPage[];
  totalPages: number;
}

function joinItems(items: any[]): string {
  let out = '';
  let lastY: number | null = null;
  for (const item of items) {
    if (typeof item?.str !== 'string') continue;
    const y = Array.isArray(item.transform) ? Math.round(item.transform[5]) : null;
    if (out && lastY !== null && y !== null && Math.abs(y - lastY) > 2) out += '\n';
    out += item.str;
    if (item.hasEOL) out += '\n';
    if (y !== null) lastY = y;
  }
  return out;
}

async function annotationText(page: any): Promise<string> {
  const notes: string[] = [];
  for (const item of (await page.getAnnotations()).slice(0, MAX_ANNOTATIONS)) {
    for (const value of [item?.contents, item?.contentsObj?.str, item?.fieldValue, item?.alternativeText]) {
      const text = Array.isArray(value) ? value.join('\n') : typeof value === 'string' ? value : '';
      if (text.trim() && !notes.includes(text)) notes.push(text.slice(0, MAX_ANNOTATION_CHARS));
    }
  }
  return notes.join('\n');
}

export async function readPdf(data: Buffer, signal?: AbortSignal): Promise<PdfRead> {
  const lib = await pdfjs();
  const standardFontDataUrl = join(dirname(require.resolve('pdfjs-dist/package.json')), 'standard_fonts') + '/';
  const task = lib.getDocument({
    data: new Uint8Array(data),
    canvasFactory: new CanvasFactory(),
    useSystemFonts: false,
    disableFontFace: true,
    isEvalSupported: false,
    standardFontDataUrl,
    verbosity: 0,
  });
  const doc = await task.promise;
  try {
    const total: number = doc.numPages;
    const pages: PdfPage[] = [];
    let imageCount = 0;
    for (let number = 1; number <= Math.min(total, MAX_PDF_PAGES); number++) {
      if (signal?.aborted) throw new ExtractCancelled();
      const page = await doc.getPage(number);
      const content = await page.getTextContent();
      const text = joinItems(content.items);
      const annotations = await annotationText(page);
      if (text.replace(/\s/g, '').length >= MIN_TEXT_CHARS) {
        pages.push({ page: number, text, ...(annotations ? { annotations } : {}) });
        page.cleanup();
        continue;
      }
      if (imageCount >= MAX_IMAGE_PAGES_PER_PDF) {
        pages.push({ page: number, text: '', notSupported: true });
        page.cleanup();
        continue;
      }
      imageCount++;
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(RENDER_SCALE, MAX_RENDER_SIDE / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport, background: 'white' }).promise;
      pages.push({ page: number, text: '', png: canvas.toBuffer('image/png'), ...(annotations ? { annotations } : {}) });
      page.cleanup();
    }
    for (let number = MAX_PDF_PAGES + 1; number <= Math.min(total, 1000); number++) {
      pages.push({ page: number, text: '', notSupported: true });
    }
    return { pages, totalPages: total };
  } finally {
    await task.destroy();
  }
}
