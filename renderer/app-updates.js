function showUpdateStatus(status) {
  const banner = findElement('#update-banner');
  if (!status || status.state === 'none') {
    banner.classList.add('hidden');
    return;
  }
  banner.classList.remove('hidden');

  if (status.state === 'downloading') {
    banner.replaceChildren(`⬇ Baixando a versão ${status.version}… ${status.percent || 0}%`);
  }
  if (status.state === 'ready-to-install') {
    banner.replaceChildren(
      `✨ A versão ${status.version} está pronta.`,
      createElement('button', { class: 'button small primary', onclick: () => desktopApp.installUpdate() }, 'Atualizar e reiniciar'),
    );
  }
  if (status.state === 'available-for-manual-download') {
    banner.replaceChildren(
      `✨ Saiu a versão ${status.version}.`,
      createElement('button', { class: 'button small primary', onclick: () => desktopApp.openReleasesPage() }, 'Baixar'),
    );
  }
}

async function initializeAppUpdates() {
  desktopApp.onUpdateStatus(showUpdateStatus);
  showUpdateStatus(await desktopApp.getUpdateStatus());
}
