// Integración con el dispositivo: app instalable (PWA), vibración,
// pantalla completa y orientación horizontal.
import { settings } from './settings.js';

export const canVibrate = () => typeof navigator.vibrate === 'function';

export function vibrate(pattern) {
  if (!settings.get('vibration') || !canVibrate()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* algunos navegadores lo bloquean sin interacción */
  }
}


export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.matchMedia('(display-mode: fullscreen)').matches ||
  window.navigator.standalone === true;

// iPhone/iPad en Safari no tiene botón de instalar: mostramos cómo hacerlo.
export const needsIosInstallHint = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone();

export const fullscreenSupported = () =>
  !!(document.fullscreenEnabled && document.documentElement.requestFullscreen);

export async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }
    await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    if (screen.orientation && screen.orientation.lock) {
      await screen.orientation.lock('landscape').catch(() => {});
    }
  } catch {
    /* el usuario o el navegador lo rechazó */
  }
}

let deferredInstall = null;

export function setupPWA({ onInstallAvailable } = {}) {
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || local)) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    if (onInstallAvailable) onInstallAvailable(true);
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    if (onInstallAvailable) onInstallAvailable(false);
  });
}

export async function promptInstall() {
  if (!deferredInstall) return false;
  deferredInstall.prompt();
  const { outcome } = await deferredInstall.userChoice;
  deferredInstall = null;
  return outcome === 'accepted';
}
