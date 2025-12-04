import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
// import legacy from '@vitejs/plugin-legacy'
import path from 'path'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    const API_PORT = env.API_PORT || 3000
    const WEB_PORT = env.PORT || 5173

    return {
        plugins: [
            react(),
            // legacy({
            //     targets: ['chrome >= 64', 'edge >= 79', 'firefox >= 67', 'safari >= 12'],
            //     renderLegacyChunks: true,
            // })
        ],
        resolve: {
            alias: {
                "@": path.resolve(__dirname, "./src"),
            },
        },
        server: {
            port: parseInt(WEB_PORT),
            proxy: {
                '/api': {
                    target: `http://127.0.0.1:${API_PORT}`,
                    changeOrigin: true,
                },
                '/ws': {
                    target: `ws://127.0.0.1:${API_PORT}`,
                    ws: true,
                }
            }
        },
        build: {
            // 生产环境构建配置
            target: 'es2015',
            minify: 'terser',
            cssCodeSplit: true,
            rollupOptions: {
                output: {
                    manualChunks: {
                        vendor: ['react', 'react-dom', 'react-router-dom', 'zustand', 'axios'],
                    }
                }
            }
        }
    }
})
