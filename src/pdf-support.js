// Lazy-loaded: pulls in pdfjs and points it at a bundled worker. indelible/pdf imports the
// same pdfjs module specifier, so it shares this instance and its worker setting.
import { GlobalWorkerOptions } from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

GlobalWorkerOptions.workerSrc = workerUrl;

export { extractPdfText, readIndelibleMetadata, parseSidecar, verifyPdf, finalizePdf } from 'indelible/pdf';
