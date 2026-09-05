import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import AutoImport from 'unplugin-auto-import/vite'
import Components from 'unplugin-vue-components/vite'
import { ElementPlusResolver } from 'unplugin-vue-components/resolvers'

// Vite 配置：负责渲染进程（Vue 3）的构建
// 主进程与预加载脚本由 Electron 直接运行（CommonJS），不经过 Vite
// 使用 .mjs 扩展名以 ESM 方式加载，避免 Vite CJS Node API 弃用警告
const __dirname = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [
    vue(),
    AutoImport({
      resolvers: [ElementPlusResolver()]
    }),
    Components({
      resolvers: [ElementPlusResolver()]
    })
  ],
  // 根目录设为当前项目根，index.html 位于根目录
  root: __dirname,
  // 基础路径：生产环境使用相对路径，便于 Electron file:// 协议加载
  base: './',

  resolve: {
    alias: {
      // @ 别名指向 src 目录，渲染进程可通过 @/xxx 引用模块
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    port: 5173,
    strictPort: true,
    // 允许任意主机访问，便于 Electron 加载
    host: '127.0.0.1'
  },
  build: {
    // 构建输出目录：dist（Electron 生产环境加载此目录）
    outDir: 'dist',
    emptyOutDir: true,
    // 生产环境关闭 sourcemap，减小体积
    sourcemap: false,
    cssCodeSplit: true,


    rollupOptions: {
      // 多入口配置：主应用 index.html + 桌面小部件 widget.html + 桌宠 pet.html + 提醒弹窗 reminder.html + 灵动岛 island.html
      // 构建后 dist/ 下同时生成 index.html、widget.html、pet.html、reminder.html 和 island.html
      input: {
        main: resolve(__dirname, 'index.html'),
        widget: resolve(__dirname, 'widget.html'),
        pet: resolve(__dirname, 'pet.html'),
        reminder: resolve(__dirname, 'reminder.html'),
        island: resolve(__dirname, 'island.html')
      },
      output: {
        // 静态资源分类输出
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
        assetFileNames: 'assets/[ext]/[name]-[hash].[ext]'
      }
    }
  },

  css: {
    preprocessorOptions: {
      scss: {
        // 使用 modern-compiler API，消除 Dart Sass legacy JS API 弃用警告
        // 需要 sass >= 1.71（当前安装版本 1.103.1）
        api: 'modern-compiler',
        // SCSS 全局变量注入（后续主题切换任务会用到）
        additionalData: `@use "@/assets/styles/variables.scss" as *;`
      }
    }
  }
})