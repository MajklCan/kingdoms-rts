/** Version + git commit tag on the title screen. */

import { byId } from './dom';

export function bindBuildInfo(): void {
  const buildEl = byId('build-info');
  if (!buildEl) return;
  const commit = __GIT_COMMIT__ && __GIT_COMMIT__ !== 'unknown'
    ? `${__GIT_COMMIT__}${__GIT_DIRTY__ ? '+dirty' : ''}`
    : 'unknown';
  buildEl.textContent = `v${__APP_VERSION__} · ${commit}`;
  buildEl.title = `Version ${__APP_VERSION__} · ${__GIT_BRANCH__} · ${commit}`;
}
