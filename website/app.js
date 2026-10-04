import { siteConfig } from './config.js';

function publicUrl(value, name) {
  if (value === null || value === undefined || value === '') return null;
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error(`${name} must be a public HTTPS URL without credentials`);
  }
  return url.href.replace(/\/$/, '');
}

/** A missing external destination always leaves a usable in-page link. */
export function resolveProjectLinks(config) {
  const repository = publicUrl(config.repositoryUrl, 'repositoryUrl');
  const status = '#project-status';
  return {
    source: repository ?? status,
    builds: publicUrl(config.buildsUrl, 'buildsUrl') ?? (repository ? `${repository}/actions` : status),
    docs: publicUrl(config.documentationUrl, 'documentationUrl') ?? (repository ? `${repository}/#readme` : status),
    license: publicUrl(config.licenseUrl, 'licenseUrl') ?? (repository ? `${repository}/blob/main/LICENSE` : status),
    notices: publicUrl(config.noticesUrl, 'noticesUrl') ?? (repository ? `${repository}/blob/main/THIRD_PARTY_NOTICES.md` : status),
    release: publicUrl(config.releaseUrl, 'releaseUrl') ?? '#platforms',
    browser: publicUrl(config.browserUrl, 'browserUrl') ?? '#platforms',
  };
}

export function applyProjectLinks(document, config) {
  const links = resolveProjectLinks(config);
  for (const anchor of document.querySelectorAll('[data-project-link]')) {
    let href = links[anchor.dataset.projectLink];
    if (href === '#project-status' && anchor.dataset.unavailableHref) href = anchor.dataset.unavailableHref;
    if (!href) continue;
    anchor.setAttribute('href', href);
    if (href.startsWith('https:')) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noopener noreferrer');
      anchor.setAttribute('aria-label', `${anchor.textContent.trim()}（新标签页）`);
    }
  }

  if (config.repositoryUrl) {
    const title = document.querySelector('[data-source-title]');
    const state = document.querySelector('[data-source-state]');
    if (title) title.textContent = '查看源码，跟进真实进展。';
    if (state) state.textContent = '源码已公开。桌面构建与各平台的可用程度，以仓库的验收说明为准。';
  }
  if (config.releaseUrl) {
    for (const anchor of document.querySelectorAll('[data-project-link="release"]')) {
      anchor.querySelector('[data-release-label]').textContent = '查看可用版本';
      anchor.setAttribute('aria-label', '查看可用版本（新标签页）');
    }
  }
  if (config.browserUrl) {
    const status = document.querySelector('[data-browser-status]');
    const description = document.querySelector('[data-browser-description]');
    const entry = document.querySelector('[data-browser-entry]');
    if (status) status.textContent = '浏览器体验版';
    if (description) description.textContent = '先读例子，再写代码、看真实运行结果并保存自己的解释。首次联网下载后可离线实践。也可自配模型、保存材料、独立侧聊和手动朗读；手机安装、键盘、声音与后台行为仍待真机验收。';
    if (entry) entry.hidden = false;
  }
}

if (typeof document !== 'undefined') applyProjectLinks(document, siteConfig);
