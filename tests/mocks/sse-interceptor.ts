import { BatchInterceptor } from '@mswjs/interceptors';
import { FetchInterceptor } from '@mswjs/interceptors/fetch';
import * as fs from 'fs';
import * as path from 'path';
import crypto from 'crypto';

const cassetteDir = path.resolve(process.cwd(), 'tests/mocks/cassettes');

// Save the original fetch to bypass the interceptor when recording
const originalFetch = globalThis.fetch;

export const interceptor = new BatchInterceptor({
  name: 'sse-interceptor',
  interceptors: [new FetchInterceptor()],
});

export function setupSSEInterceptor() {
  if (!fs.existsSync(cassetteDir)) {
    fs.mkdirSync(cassetteDir, { recursive: true });
  }

  interceptor.apply();

  interceptor.on('request', async ({ request }) => {
    if (!request.url.startsWith('http')) return;

    const url = request.url;
    const method = request.method;
    
    let body = '';
    if (request.body) {
      body = await request.clone().text();
    }
    
    const hash = crypto.createHash('sha256').update(`${method}:${url}:${body}`).digest('hex');
    const cassettePath = path.join(cassetteDir, `${hash}.json`);

    if (process.env.RECORD_HTTP === '1') {
      try {
        const actualResponse = await originalFetch(request.clone());
        const responseHeaders = Object.fromEntries(actualResponse.headers.entries());
        const status = actualResponse.status;
        
        const chunks: string[] = [];
        
        if (actualResponse.body) {
            const ts = new TransformStream({
              transform(chunk, controller) {
                chunks.push(Buffer.from(chunk).toString('base64'));
                controller.enqueue(chunk);
              },
              flush() {
                fs.writeFileSync(cassettePath, JSON.stringify({
                   url, method, status, headers: responseHeaders, chunks
                }, null, 2));
              }
            });
            
            const stream = actualResponse.body.pipeThrough(ts);
            request.respondWith(new Response(stream, {
              status,
              headers: responseHeaders
            }));
        } else {
             fs.writeFileSync(cassettePath, JSON.stringify({
               url, method, status, headers: responseHeaders, chunks: []
             }, null, 2));
             request.respondWith(new Response(null, {
              status,
              headers: responseHeaders
            }));
        }
      } catch (err) {
        console.error('Error recording actual response', err);
      }
    } else {
      if (fs.existsSync(cassettePath)) {
         const parsed = JSON.parse(fs.readFileSync(cassettePath, 'utf8'));
         const stream = new ReadableStream({
            start(controller) {
               for (const chunk of parsed.chunks) {
                  controller.enqueue(Buffer.from(chunk, 'base64'));
               }
               controller.close();
            }
         });
         request.respondWith(new Response(stream, {
            status: parsed.status,
            headers: parsed.headers as Record<string, string>
         }));
      } else {
         console.warn(`No cassette found for ${url} (hash: ${hash}). Pass RECORD_HTTP=1 to record.`);
      }
    }
  });
}

export function teardownSSEInterceptor() {
  interceptor.dispose();
}
