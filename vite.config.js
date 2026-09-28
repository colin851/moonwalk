import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

// 启用 Vue 单文件组件编译；相对资源路径便于部署到静态站点子目录。
export default defineConfig({ plugins: [vue()], base: './' });
