import * as pdfjsLib from 'pdfjs-dist';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

let initialized = false;

export function ensurePdfWorker(): void {
  if (!initialized) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
    initialized = true;
  }
}

export { pdfjsLib };
