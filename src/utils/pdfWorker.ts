import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let initialized = false;

export function ensurePdfWorker(): void {
  if (!initialized) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    initialized = true;
  }
}

export function getPdfDocumentOptions(data: Uint8Array) {
  ensurePdfWorker();
  const baseHref =
    typeof window !== 'undefined' ? new URL('./', window.location.href).href : './';
  return {
    data,
    cMapUrl: `${baseHref}pdfjs/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${baseHref}pdfjs/standard_fonts/`,
  };
}

export { pdfjsLib };
