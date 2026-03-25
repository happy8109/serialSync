import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
// import legacy from '@vitejs/plugin-legacy'
import path from 'path'
import fs from 'fs'

const packageJsonPath = path.resolve(__dirname, '../../package.json')
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'))

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '')
    const API_PORT = env.API_PORT || 3000
    const WEB_PORT = env.PORT || 5173

    return {
        define: {
            __APP_VERSION__: JSON.stringify(packageJson.version),
        },
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
            host: true,
            port: parseInt(WEB_PORT),
            allowedHosts: true,
            proxy: {
                '/api': {
                    target: `http://127.0.0.1:${API_PORT}`,
                    changeOrigin: true,
                },
                '/ws': {
                    target: `ws://127.0.0.1:${API_PORT}`,
                    ws: true,
                    configure: (proxy, _options) => {
                        // Increase timeout to ensure we run after Vite attaches its own listeners
                        setTimeout(() => {
                            // Remove default error handler (which logs connection errors)
                            proxy.removeAllListeners('error');

                            proxy.on('error', (err, _req, _res) => {
                                // Suppress ECONNRESET and ECONNABORTED errors
                                if (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED' || err.code === 'EPIPE') {
                                    return;
                                }
                                // console.log('Proxy error:', err); // Silence other proxy errors too for now to keep terminal clean
                            });
                        }, 200); // 200ms delay to be safe

                        proxy.on('proxyReq', (proxyReq, req, _res) => {
                            proxyReq.on('error', (err) => {
                                if (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED' || err.code === 'EPIPE') {
                                    return;
                                }
                            });
                        });
                        proxy.on('proxyReqWs', (proxyReq, req, socket, options, head) => {
                            socket.on('error', (err) => {
                                if (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED' || err.code === 'EPIPE') {
                                    return;
                                }
                            });
                            proxyReq.on('error', (err) => {
                                if (err.code === 'ECONNRESET' || err.code === 'ECONNABORTED' || err.code === 'EPIPE') {
                                    return;
                                }
                            });
                        });
                    }
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
