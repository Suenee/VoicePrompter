import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import path from 'path'

const staticHtmlFiles = ['index.html', 'about.html', 'privacy.html', 'terms.html', 'changelog.html']
const staticDirectories = ['blog', 'mac', 'ios', 'ipad', 'android', 'web']
const DOC_ID_RE = /^[a-zA-Z0-9-_]{25,110}$/

function copyDirectory(source: string, target: string): void {
    if (!fs.existsSync(source)) return
    fs.mkdirSync(target, { recursive: true })
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, entry.name)
        const targetPath = path.join(target, entry.name)
        if (entry.isDirectory()) { copyDirectory(sourcePath, targetPath); continue }
        if (entry.name.toLowerCase().endsWith('.md')) continue
        fs.copyFileSync(sourcePath, targetPath)
    }
}

function disableTrackingInDevelopment() {
    return {
        name: 'disable-tracking-in-development',
        apply: 'serve' as const,
        transformIndexHtml(html: string) {
            return html
                .replace(/\s*<!-- Umami Analytics -->\s*<script\b[^>]*reactive-analytics\.up\.railway\.app\/script\.js[^>]*><\/script>/i, '')
                .replace(/\s*<!-- Ansvisor AI-traffic tracking -->\s*<script\b[^>]*api\.ansvisor\.com\/t\.js[^>]*><\/script>/i, '')
                .replace(/\s*<script\b[^>]*reactive-analytics\.up\.railway\.app\/recorder\.js[^>]*><\/script>/i, '')
        }
    }
}

// Development-only same-origin proxy. This deliberately avoids the public
// Cloudflare Worker's Origin allowlist, which cannot safely enumerate arbitrary
// private-LAN addresses such as http://192.168.x.x:5173.
function googleDocDevelopmentProxy() {
    return {
        name: 'google-doc-development-proxy',
        apply: 'serve' as const,
        configureServer(server: { middlewares: { use: (route: string, handler: (req: { url?: string }, res: import('http').ServerResponse) => void) => void } }) {
            server.middlewares.use('/gdoc-proxy', async (req, res) => {
                try {
                    const requestUrl = new URL(req.url || '/', 'http://localhost')
                    const docId = requestUrl.searchParams.get('id') || ''
                    if (!DOC_ID_RE.test(docId)) {
                        res.statusCode = 400; res.end('Missing or invalid Google Doc ID'); return
                    }
                    const upstream = await fetch(`https://docs.google.com/document/d/${docId}/export?format=txt`, { redirect: 'follow' })
                    if (!upstream.ok) {
                        res.statusCode = upstream.status === 404 ? 404 : 403
                        res.end('Could not fetch document. Make sure it is shared as "Anyone with the link" (Viewer).')
                        return
                    }
                    const contentType = upstream.headers.get('content-type') || ''
                    if (contentType.includes('text/html')) {
                        res.statusCode = 403; res.end('Document is not public. Share it as "Anyone with the link" (Viewer) and try again.'); return
                    }
                    res.statusCode = 200
                    res.setHeader('Content-Type', 'text/plain; charset=utf-8')
                    res.setHeader('Cache-Control', 'no-store')
                    res.end(await upstream.text())
                } catch (error) {
                    console.error('[gdoc-proxy] Google Docs fetch failed:', error)
                    res.statusCode = 502; res.end('Google Docs upstream request failed')
                }
            })
        }
    }
}

function copyStaticSite() {
    return {
        name: 'copy-static-site',
        closeBundle() {
            const root = __dirname
            const dist = path.resolve(root, 'dist')
            fs.mkdirSync(dist, { recursive: true })
            for (const file of staticHtmlFiles) {
                const source = path.resolve(root, file)
                if (fs.existsSync(source)) fs.copyFileSync(source, path.resolve(dist, file))
            }
            for (const directory of staticDirectories) copyDirectory(path.resolve(root, directory), path.resolve(dist, directory))
        }
    }
}

export default defineConfig({
    appType: 'mpa',
    plugins: [
        disableTrackingInDevelopment(),
        googleDocDevelopmentProxy(),
        VitePWA({
            registerType: 'autoUpdate',
            workbox: { navigateFallbackDenylist: [/^\/mac/, /^\/ios/, /^\/ipad/, /^\/android/, /^\/web/, /^\/about/, /^\/blog/, /^\/changelog/] },
            includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
            manifest: {
                name: 'VoicePrompter', short_name: 'VoicePrompter', description: 'A voice-activated teleprompter app',
                theme_color: '#000000', background_color: '#000000', display: 'standalone', start_url: '/app/', scope: '/app/',
                icons: [
                    { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
                    { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' }
                ]
            }
        }),
        copyStaticSite()
    ],
    build: { rollupOptions: { input: { app: 'app/index.html' } } }
})
