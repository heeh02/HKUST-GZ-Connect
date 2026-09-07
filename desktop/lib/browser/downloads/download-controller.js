'use strict';

// Download state and native DownloadItem callbacks have one owner. Browser
// composition supplies current UI effects without routing or credential access.
class BrowserDownloadController {
  constructor({ getDialog, getWindow, getOnError, t, showItemInFolder, onStateChanged }) {
    this.getDialog = getDialog;
    this.getWindow = getWindow;
    this.getOnError = getOnError;
    this.t = t;
    this.showItemInFolder = showItemInFolder;
    this.scheduleToolbarUpdate = onStateChanged;
    this.downloadSessions = new Set();
    this.downloadState = null;
  }

  get dialog() { return this.getDialog(); }
  get window() { return this.getWindow(); }
  get onError() { return this.getOnError(); }

  // Electron would otherwise silently drop downloads because the campus
  // sessions have no default download behavior wired to a dialog.
  applyDownloadHandler(routeSession) {
    if (typeof routeSession.on !== 'function' || this.downloadSessions.has(routeSession)) {
      return;
    }
    this.downloadSessions.add(routeSession);
    routeSession.on('will-download', (_event, item) => this.handleDownload(item));
  }

  async handleDownload(item) {
    if (!this.dialog?.showSaveDialog) {
      item.cancel();
      return;
    }
    try {
      const parent = this.window && !this.window.isDestroyed?.() ? this.window : undefined;
      const result = await this.dialog.showSaveDialog(parent, {
        defaultPath: item.getFilename(),
      });
      if (result.canceled || !result.filePath) {
        item.cancel();
        return;
      }
      item.setSavePath(result.filePath);
      const filename = String(item.getFilename() || '').slice(0, 160);
      const updateProgress = () => {
        const total = Number(item.getTotalBytes?.());
        const received = Number(item.getReceivedBytes?.());
        const percent = Number.isFinite(total) && total > 0 && Number.isFinite(received)
          ? Math.max(0, Math.min(100, Math.round(received * 100 / total))) : null;
        this.downloadState = Object.freeze({ filename, status: 'downloading', percent });
        this.scheduleToolbarUpdate();
      };
      item.on?.('updated', updateProgress);
      updateProgress();
      item.once('done', async (_event, state) => {
        this.downloadState = Object.freeze({
          filename,
          status: state === 'completed' ? 'completed' : 'interrupted',
          percent: state === 'completed' ? 100 : null,
        });
        this.scheduleToolbarUpdate();
        if (state === 'interrupted' && this.onError) {
          this.onError(this.t('download.interrupted', { filename: item.getFilename() }));
        }
        if (state === 'completed' && typeof this.dialog.showMessageBox === 'function') {
          try {
            const prompt = await this.dialog.showMessageBox(this.window, {
              type: 'info',
              message: this.t('download.completed', { filename }),
              buttons: [this.t('download.showInFolder'), this.t('common.close')],
              defaultId: 0,
              cancelId: 1,
              noLink: true,
            });
            if (prompt.response === 0) this.showItemInFolder(result.filePath);
          } catch {}
        }
      });
    } catch {
      // The item may already have finished while the dialog was open.
      try { item.cancel(); } catch {}
      if (this.onError) this.onError(this.t('download.noLocation'));
    }
  }

}

module.exports = { BrowserDownloadController };
