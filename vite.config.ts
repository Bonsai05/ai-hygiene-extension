import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteStaticCopy } from 'vite-plugin-static-copy';
import path from 'path';

// https://vitejs.dev/config/
export default defineConfig({
    plugins: [
        react(),
        viteStaticCopy({
            targets: [
                {
                    src: 'node_modules/@huggingface/transformers/dist/*.jsep.wasm',
                    dest: 'assets',
                },
                {
                    src: 'node_modules/@huggingface/transformers/dist/*.jsep.mjs',
                    dest: 'assets',
                },
            ],
        }),
    ],
    build: {
        outDir: 'dist',
        rollupOptions: {
            input: {
                popup: path.resolve(__dirname, 'index.html'),
                background: path.resolve(__dirname, 'src/background.ts'),
                'content-script': path.resolve(__dirname, 'src/content-script.ts'),
                offscreen: path.resolve(__dirname, 'public/offscreen.html'),
            },
            output: {
                entryFileNames: 'assets/[name].js',
                chunkFileNames: 'assets/[name].js',
                assetFileNames: 'assets/[name].[ext]',
            },
        },
    },
    optimizeDeps: {
        exclude: ['@huggingface/transformers'],
    },
    resolve: {
        browserField: false,
        mainFields: ['module', 'jsnext:main', 'jsnext'],
    },
});
