import { removeGoogleDocFromHistory } from './storage';

/**
 * Utility functions for Google Docs integration.
 */

export class GoogleDocFetchError extends Error {
    permanent: boolean;

    constructor(message: string, permanent = false) {
        super(message);
        this.name = 'GoogleDocFetchError';
        this.permanent = permanent;
    }
}

export function isPermanentGoogleDocError(error: unknown): boolean {
    return error instanceof GoogleDocFetchError && error.permanent;
}

function throwPermanentGoogleDocError(docUrl: string, error: GoogleDocFetchError): never {
    removeGoogleDocFromHistory(docUrl);
    throw error;
}

export function extractDocId(url: string): string | null {
    const docIdRegex = /\/document\/d\/([a-zA-Z0-9-_]{25,110})/;
    const match = url.match(docIdRegex);
    return match ? match[1] : null;
}

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeout = 6000): Promise<Response> {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);
    try {
        const response = await fetch(url, { ...options, signal: controller.signal });
        clearTimeout(id);
        return response;
    } catch (err) {
        clearTimeout(id);
        throw err;
    }
}

export async function fetchGoogleDocText(docUrl: string): Promise<string> {
    const docId = extractDocId(docUrl);
    if (!docId) {
        throwPermanentGoogleDocError(docUrl, new GoogleDocFetchError('Invalid Google Doc URL. Please check the link and try again.', true));
    }

    const exportUrl = `https://docs.google.com/document/d/${docId}/export?format=txt&cb=${Date.now()}`;
    const isViteDevelopment = window.location.port === '5173' || window.location.port === '4173';
    const proxies = [
        ...(isViteDevelopment ? [`/gdoc-proxy?id=${encodeURIComponent(docId)}`] : []),
        `https://gdoc-proxy.kosuvorov.workers.dev/?id=${docId}`,
        `https://api.allorigins.win/raw?url=${encodeURIComponent(exportUrl)}`,
        `https://corsproxy.io/?${encodeURIComponent(exportUrl)}`
    ];

    let lastError: unknown = null;
    let permanentError: GoogleDocFetchError | null = null;

    for (const proxyUrl of proxies) {
        try {
            const response = await fetchWithTimeout(proxyUrl, { cache: 'no-store' }, 6000);
            if (!response.ok) {
                const errorBody = await response.text();
                const isTrustedSourceProxy = proxyUrl.startsWith('/gdoc-proxy') || proxyUrl.includes('gdoc-proxy.kosuvorov.workers.dev');
                const definitiveSourceFailure = isTrustedSourceProxy && (
                    response.status === 404 ||
                    (response.status === 403 && (
                        errorBody.includes('Could not fetch document') ||
                        errorBody.includes('Document is not public')
                    ))
                );

                if (definitiveSourceFailure) {
                    permanentError = new GoogleDocFetchError(
                        'Document access denied or document not found. Please verify the Google Doc is shared with "Anyone with the link" as a Viewer.',
                        true
                    );
                    throw permanentError;
                }

                throw new GoogleDocFetchError(`Proxy returned status ${response.status}${errorBody ? `: ${errorBody.slice(0, 160)}` : ''}`);
            }

            const text = await response.text();
            if (!text || text.trim().length === 0) throw new GoogleDocFetchError('The retrieved document is empty.');

            if (text.trim().startsWith('<!DOCTYPE html>') || text.includes('<html')) {
                if (text.includes('google-signin') || text.includes('accounts.google.com') || text.includes('ServiceLogin')) {
                    permanentError = new GoogleDocFetchError(
                        'Document access denied. Please verify your Google Doc is shared with "Anyone with the link" as a Viewer.',
                        true
                    );
                    throw permanentError;
                }
                throw new GoogleDocFetchError('Failed to retrieve plain text. The page was redirected.');
            }

            return text;
        } catch (error: unknown) {
            console.warn(`Failed to fetch via proxy ${proxyUrl}:`, error);
            lastError = error;
        }
    }

    if (permanentError) throwPermanentGoogleDocError(docUrl, permanentError);
    if (lastError instanceof GoogleDocFetchError && lastError.permanent) throwPermanentGoogleDocError(docUrl, lastError);

    const detail = lastError instanceof Error ? ` Last error: ${lastError.message}` : '';
    throw new GoogleDocFetchError(`Failed to connect to Google Docs through the available proxy routes.${detail}`);
}
