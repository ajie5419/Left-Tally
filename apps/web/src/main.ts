import { createApp } from 'vue';
import { createPinia } from 'pinia';
import { createRouter, createWebHistory } from 'vue-router';
import App from './App.vue';
import BootstrapPage from './BootstrapPage.vue';
import 'ant-design-vue/es/style/default.css';
import 'ant-design-vue/es/button/style/index.css';
import 'ant-design-vue/es/tag/style/index.css';
import './style.css';

const router = createRouter({
  history: createWebHistory(),
  routes: [{ path: '/', component: BootstrapPage }],
});

createApp(App).use(createPinia()).use(router).mount('#app');
