import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'
import fs from 'fs'
import path from 'path'

// Blog pages are fully generated static HTML. Processing them again as Vite
// HTML entrypoints is unnecessary and can trigger Vite's html-proxy inline-CSS
// path handling on Windows. Copy the generated HTML files to dist unchanged.
function copyGeneratedBlogHtml() {
    return {
        name: 'copy-generated-blog-html',
        closeBundle() {
            const blogDir = path.resolve(__dirname, 'blog');
            const distBlogDir = path.resolve(__dirname, 'dist/blog');
            if (!fs.existsSync(blogDir)) return;

            fs.mkdirSync(distBlogDir, { recursive: true });
            for (const file of fs.readdirSync(blogDir)) {
                if (!file.endsWith('.html')) continue;
                fs.copyFileSync(path.join(blogDir, file), path.join(distBlogDir, file));
            }
        }
    }
}

// Dynamically gather all generated use-case HTML files
const macDir = path.resolve(__dirname, 'mac');
const useCaseInputs: Record<string, string> = {};
if (fs.existsSync(macDir)) {
    const folders = fs.readdirSync(macDir).filter(f => fs.statSync(path.join(macDir, f)).isDirectory());
    folders.forEach(folder => {
        useCaseInputs[`usecase_${folder}`] = `mac/${folder}/index.html`;
    });
}

export default defineConfig({
    appType: 'mpa',
    // base: '/Teleprompter/', // Removed for custom domain
    plugins: [
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
        copyGeneratedBlogHtml()
    ],
    build: {
        rollupOptions: {
            input: {
                hub: 'index.html',
                app: 'app/index.html',
                about: 'about.html',
                privacy: 'privacy.html',
                terms: 'terms.html',
                changelog: 'changelog.html',
                mac: 'mac/index.html',
                ios: 'ios/index.html',
                ipad: 'ipad/index.html',
                android: 'android/index.html',
                web: 'web/index.html',
                ...useCaseInputs
            }
        }
    }
})
