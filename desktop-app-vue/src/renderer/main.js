import { createApp } from 'vue';
import { createPinia } from 'pinia';
import Antd from 'ant-design-vue';
import App from './App.vue';
import router from './router';
import i18n from './locales';
import 'ant-design-vue/dist/reset.css';
import 'prosemirror-view/style/prosemirror.css';
import './style.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(i18n);
app.use(Antd);

app.mount('#app');
