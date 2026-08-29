import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import path from 'path'

const staticHtmlFiles = [
    'index.html',
    'about.html',
    'privacy.html',
    'terms.html',
    'changelog.html'
]

const staticDirectories = [
    'blog',
    'mac',
    'ios',
    'ipad',
    'android',
    'web'
]

function copyDirectory(source: string, target: string): void {
    if (!fs.existsSync(source)) return
    fs.mkdirSync(target, { recursive: true })

    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const sourcePath = path.join(source, entry.name)
        const targetPath = path.join(target, entry.name)

        if (entry.isDirectory()) {
            copyDirectory(sourcePath, targetPath)
            continue
        }

        // Markdown files are build sources for the generated blog and are not
        // part of the deployed static site.
        if (entry.name.toLowerCase().endsWith('.md')) continue
        fs.copyFileSync(sourcePath, targetPath)
    }
}

// Keep third-party analytics/session recording out of the Vite development
// server. This keeps localhost/devel debugging clean while leaving production
// builds and the author's deployed analytics unchanged.
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

// The marketing/site pages are already complete static HTML and contain large
// inline style blocks. Re-processing them as Vite HTML entrypoints is both
// unnecessary and can trigger html-proxy inline-CSS failures on Windows.
// Build only the actual VoicePrompter app and copy the static site unchanged.
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

            for (const directory of staticDirectories) {
                copyDirectory(path.resolve(root, directory), path.resolve(dist, directory))
            }
        }
    }
}

export default defineConfig({
    appType: 'mpa',
    plugins: [
        disableTrackingInDevelopment(),
        VitePWA({
            registerType: 'autoUpdate',
            workbox: {
                navigateFallbackDenylist: [/^\/mac/, /^\/ios/, /^\/ipad/, /^\/android/, /^\/web/, /^\/about/, /^\/blog/, /^\/changelog/]
            },
            includeAssets: ['favicon.ico', 'apple-touch-icon.png'],
            manifest: {
                name: 'VoicePrompter',
                short_name: 'VoicePrompter',
                description: 'A voice-activated teleprompter app',
                theme_color: '#000000',
                background_color: '#000000',
                display: 'standalone',
                start_url: '/app/',
                scope: '/app/',
                icons: [
                    {
                        src: 'pwa-192x192.png',
                        sizes: '192x192',
                        type: 'image/png'
                    },
                    {
                        src: 'pwa-512x512.png',
                        sizes: '512x512',
                        type: 'image/png'
                    }
                ]
            }
        }),
        copyStaticSite()
    ],
    build: {
        rollupOptions: {
            input: {
                app: 'app/index.html'
            }
        }
    }
})
