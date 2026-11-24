/**
 * The only way into the PDF code. The PDF library is large, so it is fetched
 * here, when "Download PDF" is pressed, and by nothing else: no other file may
 * import the pdf folder or the library in the ordinary way (pdf-lazy.test.ts).
 */
export const loadPdfBuilder = () => import('./pdf/build');
