import { createApp } from 'vue';
import App from './App.vue';
import './style.css';

// 启动入口：导入全局样式后，将根组件挂载到 index.html 的 #app。
createApp(App).mount('#app');
