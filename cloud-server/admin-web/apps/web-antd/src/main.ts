import { initPreferences } from '@vben/preferences';
import { unmountGlobalLoading } from '@vben/utils';

import { overridesPreferences, preferencesExtension } from './preferences';

/**
 * 应用初始化完成之后再进行页面加载渲染
 */
async function initApplication() {
  // name用于指定项目唯一标识
  // 用于区分不同项目的偏好设置以及存储数据的key前缀以及其他一些需要隔离的数据
  const env = import.meta.env.PROD ? 'prod' : 'dev';
  const appVersion = import.meta.env.VITE_APP_VERSION;
  const namespace = `${import.meta.env.VITE_APP_NAMESPACE}-${appVersion}-${env}`;

  // app偏好设置初始化
  await initPreferences({
    extension: preferencesExtension,
    namespace,
    overrides: overridesPreferences,
  });

  // 启动应用并挂载
  // vue应用主要逻辑及视图
  const { bootstrap } = await import('./bootstrap');
  await bootstrap(namespace);

  // 移除并销毁loading
  unmountGlobalLoading();
}

initApplication().catch((error) => {
  console.error('管理后台启动失败', error);
  unmountGlobalLoading();
  const root = document.querySelector<HTMLDivElement>('#app');
  if (!root) return;
  root.replaceChildren();
  const panel = document.createElement('div');
  panel.style.cssText = 'display:grid;min-height:100vh;place-items:center;padding:24px;background:#f4f7f9;color:#334155;font-family:system-ui,-apple-system,sans-serif;text-align:center';
  const content = document.createElement('div');
  const title = document.createElement('h1');
  title.textContent = '管理后台暂时无法启动';
  title.style.fontSize = '22px';
  const detail = document.createElement('p');
  detail.textContent = '请检查网络或服务状态后重新加载。';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.textContent = '重新加载';
  retry.style.cssText = 'min-height:44px;margin-top:12px;padding:0 22px;border:0;border-radius:10px;color:#fff;background:#2563eb;font-weight:600;cursor:pointer';
  retry.addEventListener('click', () => location.reload());
  content.append(title, detail, retry);
  panel.append(content);
  root.append(panel);
});
