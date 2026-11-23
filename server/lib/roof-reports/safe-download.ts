import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { assertSafeFetchUrl } from './url-safety.js';
import { isPrivateIp } from './safe-fetch.js';

export function isPublicAddress(address: string): boolean {
  // isPrivateIp fails closed: anything that is not a public IP literal is refused.
  return !isPrivateIp(address);
}
/** Resolve once and pin that vetted address to the connection (including TLS).
 * No redirects, proxies, connection reuse, or unbounded response buffering.
 */
export async function downloadPublicMedia(rawUrl: string, options: {maxBytes:number;timeoutMs?:number}) {
  assertSafeFetchUrl(rawUrl);
  const url = new URL(rawUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('Media download timed out')), options.timeoutMs ?? 30000);
  const signal = controller.signal;
  let onAbort: (() => void) | undefined;
  try {
    const addresses = await Promise.race([
      isIP(hostname) ? Promise.resolve([{address:hostname,family:isIP(hostname)}]) : lookup(hostname, {all:true,verbatim:true}),
      new Promise<never>((_,reject) => { onAbort = () => reject(signal.reason); signal.addEventListener('abort', onAbort, {once:true}); }),
    ]);
    if (!addresses.length || addresses.some(a => !isPublicAddress(a.address))) throw new Error('Unsafe URL: DNS resolved to a private or reserved address');
    const chosen = addresses[0];
    signal.throwIfAborted();
    const pinnedLookup: RequestOptions['lookup'] = (_host, opts, callback) => {
      if (typeof opts === 'object' && opts.all) callback(null, [{address:chosen.address,family:chosen.family}]);
      else callback(null, chosen.address, chosen.family);
    };
    const response = await new Promise<IncomingMessage>((resolve,reject) => {
      const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
        method:'GET', agent:false, lookup:pinnedLookup, signal,
        headers:{'Accept-Encoding':'identity','User-Agent':'ArchieReportMedia/1.0'},
      }, resolve);
      request.on('error',reject);
      request.end();
    });
    try {
      if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) throw new Error('Media download failed or redirected (' + response.statusCode + ')');
      if (Number(response.headers['content-length']) > options.maxBytes) throw new Error('Media exceeds the download size limit');
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of response) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        size += bytes.length;
        if (size > options.maxBytes) throw new Error('Media exceeds the download size limit');
        chunks.push(bytes);
      }
      if (!size) throw new Error('Media response is empty');
      return {bytes:Buffer.concat(chunks),contentType:(response.headers['content-type'] || 'application/octet-stream').split(';')[0].trim().toLowerCase()};
    } finally { response.destroy(); }
  } finally {
    clearTimeout(timer);
    if (onAbort) signal.removeEventListener('abort', onAbort);
  }
}
export async function downloadReportImage(url: string): Promise<string> {
  const media = await downloadPublicMedia(url, {maxBytes:20*1024*1024,timeoutMs:30000});
  if (!/^image\/(jpeg|png|webp|gif)$/.test(media.contentType)) throw new Error('Unsupported report photo type');
  return 'data:' + media.contentType + ';base64,' + media.bytes.toString('base64');
}
