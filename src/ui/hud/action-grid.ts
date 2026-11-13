/** Bottom-right action grid: build / train / tech / command cells. */

import type { GameScene } from '../../render/game-scene';
import { byId } from '../dom';
import { renderHudVoxelIcon, renderResourceCost } from '../icons/voxel-icons';

let lastActionsKey = '';

export function updateActionGrid(scene: GameScene): void {
  const actionGridEl = byId('action-grid');
  if (!actionGridEl) return;
  const actions = scene.getAvailableActions();
  // Build a signature so we only rebuild on change.
  const sig = actions
    .map((a) =>
      [
        a.id,
        a.kind,
        a.label,
        a.enabled ? 1 : 0,
        a.cost ?? '',
        a.meta ?? '',
        a.queue ?? 0,
        a.active ? 1 : 0,
        a.disabledReason ?? '',
        a.hudIcon ?? '',
      ].join(':')
    )
    .join(',') || 'empty';
  if (sig === lastActionsKey) return;
  lastActionsKey = sig;
  actionGridEl.innerHTML = '';

  const hasTraining = actions.some((a) => a.kind === 'train');
  actionGridEl.classList.toggle('training-mode', hasTraining);

  const header = document.createElement('div');
  header.className = 'action-header';
  const title = document.createElement('span');
  title.textContent = hasTraining ? 'Production' : 'Actions';
  const detail = document.createElement('small');
  detail.textContent = hasTraining ? `${actions.filter((a) => a.kind === 'train').length} unit types` : `${actions.length} available`;
  header.append(title, detail);
  actionGridEl.appendChild(header);

  const cells = document.createElement('div');
  cells.className = 'action-cells' + (hasTraining ? ' training-cells' : '');
  actionGridEl.appendChild(cells);

  const slotCount = hasTraining ? Math.max(4, Math.min(6, actions.length + (actions.length % 2))) : 12;
  for (let i = 0; i < slotCount; i++) {
    const a = actions[i];
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'cell' +
      (a ? ` ${a.kind}-card` : ' empty') +
      (a?.active ? ' active' : '') +
      (a && a.enabled ? '' : ' disabled');
    if (a) {
      cell.disabled = !a.enabled;
      cell.title = a.disabledReason ? `${a.label} - ${a.disabledReason}` : a.label;
      cell.dataset.actionId = a.id;

      const key = document.createElement('span');
      key.className = 'key';
      key.textContent = a.key;

      const icon = document.createElement('span');
      if (a.hudIcon) {
        icon.className = 'icon voxel-action-icon-wrap';
        icon.innerHTML = renderHudVoxelIcon(a.hudIcon);
      } else {
        icon.className = 'icon';
        icon.textContent = a.glyph;
      }

      const body = document.createElement('span');
      body.className = 'action-body';
      const label = document.createElement('span');
      label.className = 'action-label';
      label.textContent = a.kind === 'build'
        ? a.label.replace(/^Build\s+/, '')
        : a.label.replace(/^Train\s+/, '');
      body.appendChild(label);
      if (a.meta || a.disabledReason) {
        const meta = document.createElement('span');
        meta.className = 'action-meta';
        meta.textContent = a.enabled ? (a.meta ?? '') : (a.disabledReason ?? a.meta ?? '');
        body.appendChild(meta);
      }

      cell.append(key, icon, body);

      if (a.cost) {
        const cost = document.createElement('span');
        cost.className = 'cost';
        cost.innerHTML = renderResourceCost(a.cost);
        cell.appendChild(cost);
      }

      if ((a.queue ?? 0) > 0) {
        const queue = document.createElement('span');
        queue.className = 'queue-badge';
        queue.textContent = String(a.queue);
        cell.appendChild(queue);
      }

      const tooltip = document.createElement('span');
      tooltip.className = 'tooltip';
      tooltip.textContent = a.disabledReason ? `${a.label}: ${a.disabledReason}` : a.label;
      cell.appendChild(tooltip);

      if (a.enabled) {
        cell.addEventListener('click', (ev) => {
          scene.triggerAction(a.id, a.kind === 'train' && ev.shiftKey ? 5 : 1);
        });
      }
    } else {
      cell.disabled = true;
    }
    cells.appendChild(cell);
  }
}
