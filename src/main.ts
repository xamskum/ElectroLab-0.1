/**
 * ElectroLab — Entry point
 * Learn electronics by doing. Physics first, theory after.
 */

import { Game } from './core/Game';

const loading = document.getElementById('loading');

async function boot() {
  try {
    const game = new Game();
    await game.init();
    if (loading) loading.style.display = 'none';
    game.start();
  } catch (err) {
    console.error('Boot failed:', err);
    if (loading) {
      loading.innerHTML = `<h1>ERROR</h1><p>${String(err)}</p>`;
    }
  }
}

boot();
