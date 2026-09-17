/**
 * gdoc-proxy — Cloudflare Worker
 *
 * Fetches public Google Docs exports with CORS headers for VoicePrompter.
 * Default format is plain text. format=html returns Google's HTML export
 * (normally a ZIP archive) so VP can preserve supported source formatting.
 */

const ALLOWED_ORIGINS = [
    'https://voiceprompter.app',
    'https://www.voiceprompter.app',
    'http://localhost:5173',
    'http://localhost:4173',
];

const DOC_ID_RE = /^[a-zA-Z0-9-_]{25,110}$/;

function corsHeaders(origin) {
    return {
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Vary': 'Origin',
    };
}

export default {
    async fetch(request, env) {
        const origin = request.headers.get('Origin') || '';
        if (!ALLOWED_ORIGINS.includes(origin)) {
            return new Response('Forbidden: this proxy only serves the VoicePrompter app.', { status: 403 });
        }
        const cors = corsHeaders(origin);

        if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
        if (request.method !== 'GET') return new Response('Method not allowed', { status: 405, headers: cors });

        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const { success } = await env.RATE_LIMITER.limit({ key: ip });
        if (!success) {
            return new Response('Too many requests. Please slow down and try again in a minute.', {
                status: 429,
                headers: { ...cors, 'Retry-After': '60' },
            });
        }

        const requestUrl = new URL(request.url);
        const docId = requestUrl.searchParams.get('id') || '';
        const format = requestUrl.searchParams.get('format') === 'html' ? 'html' : 'txt';
        if (!DOC_ID_RE.test(docId)) {
            return new Response('Missing or invalid ?id= Google Doc ID', { status: 400, headers: cors });
        }

        const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=${format}`;
        const upstream = await fetch(exportUrl, { redirect: 'follow' });

        if (!upstream.ok) {
            const status = upstream.status === 404 ? 404 : 403;
            return new Response(
                'Could not fetch document. Make sure it is shared as "Anyone with the link" (Viewer).',
                { status, headers: cors }
            );
        }

        const contentType = upstream.headers.get('Content-Type') || '';
        if (format === 'txt' && contentType.includes('text/html')) {
            return new Response(
                'Document is not public. Share it as "Anyone with the link" (Viewer) and try again.',
                { status: 403, headers: cors }
            );
        }

        return new Response(upstream.body, {
            status: 200,
            headers: {
                ...cors,
                'Content-Type': contentType || (format === 'html' ? 'application/zip' : 'text/plain; charset=utf-8'),
                'Cache-Control': 'no-store',
            },
        });
    },
};
