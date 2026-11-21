const shareDialog = {
  sources: [],
  activeTab: 'screen',
  selectedSource: null,
  mode: 'start',
  draftSettings: null,
};

function initializeShareDialog() {
  findElement('#close-share-dialog-button').addEventListener('click', closeShareDialog);
  findElement('#cancel-share-button').addEventListener('click', closeShareDialog);
  findElement('#confirm-share-button').addEventListener('click', confirmShareDialog);
  findElement('#refresh-sources-button').addEventListener('click', loadCaptureSources);
  findElement('#share-dialog').addEventListener('mousedown', (event) => {
    if (event.target.id === 'share-dialog') closeShareDialog();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isShareDialogOpen()) closeShareDialog();
  });
  for (const tab of findAllElements('.source-tab')) {
    tab.addEventListener('click', () => {
      shareDialog.activeTab = tab.dataset.tab;
      renderCaptureSources();
    });
  }

  bindSegmentedOption('#resolution-options', 'resolution', String, () => {
    shareDialog.draftSettings.bitrateMegabits = DEFAULT_BITRATE_MEGABITS_BY_RESOLUTION[shareDialog.draftSettings.resolution];
  });
  bindSegmentedOption('#fps-options', 'framesPerSecond', Number);
  bindSegmentedOption('#priority-options', 'priority', String);

  findElement('#bitrate-slider').addEventListener('input', (event) => {
    shareDialog.draftSettings.bitrateMegabits = Number(event.target.value);
    showDraftSettings();
  });
  findElement('#share-audio-checkbox').addEventListener('change', (event) => {
    shareDialog.draftSettings.shareAudio = event.target.checked;
    showDraftSettings();
  });
  findElement('#exclude-discord-checkbox').addEventListener('change', (event) => {
    shareDialog.draftSettings.excludeDiscordAudio = event.target.checked;
  });
  findElement('#codec-select').addEventListener('change', (event) => {
    shareDialog.draftSettings.codec = event.target.value;
  });
  findElement('#upload-limit-input').addEventListener('input', (event) => {
    shareDialog.draftSettings.uploadLimitMegabits = Math.max(0, Number(event.target.value) || 0);
  });
}

function bindSegmentedOption(containerSelector, settingName, convertValue, afterChange) {
  for (const button of findAllElements(`${containerSelector} button`)) {
    button.addEventListener('click', () => {
      shareDialog.draftSettings[settingName] = convertValue(button.dataset.value);
      if (afterChange) afterChange();
      showDraftSettings();
    });
  }
}

function isShareDialogOpen() {
  return !findElement('#share-dialog').classList.contains('hidden');
}

const SHARE_DIALOG_MODES = {
  start: { title: 'Compartilhar tela', confirmLabel: '🔴 Ao vivo', confirmClass: 'button live', showsSourcePicker: true },
  adjust: { title: 'Qualidade da transmissão', confirmLabel: 'Aplicar', confirmClass: 'button primary', showsSourcePicker: false },
  switch: { title: 'Trocar o que está sendo transmitido', confirmLabel: '🔄 Trocar', confirmClass: 'button primary', showsSourcePicker: true },
};

async function openShareDialog({ mode }) {
  const effectiveMode = mode !== 'start' && !appState.myBroadcast ? 'start' : mode;
  const modeDetails = SHARE_DIALOG_MODES[effectiveMode];
  shareDialog.mode = effectiveMode;
  shareDialog.draftSettings = { ...(effectiveMode === 'start' ? appState.shareSettings : appState.myBroadcast.settings) };

  const dialog = findElement('#share-dialog');
  dialog.classList.toggle('adjust-mode', !modeDetails.showsSourcePicker);
  findElement('#share-dialog-title').textContent = modeDetails.title;
  const confirmButton = findElement('#confirm-share-button');
  confirmButton.textContent = modeDetails.confirmLabel;
  confirmButton.className = modeDetails.confirmClass;

  showDraftSettings();
  dialog.classList.remove('hidden');
  if (modeDetails.showsSourcePicker) await loadCaptureSources();
  updateConfirmButton();
}

function closeShareDialog() {
  findElement('#share-dialog').classList.add('hidden');
}

async function loadCaptureSources() {
  findElement('#source-grid').replaceChildren(createElement('div', { class: 'empty-message' }, createElement('span', { class: 'spinner' }), 'Carregando…'));
  try {
    shareDialog.sources = await desktopApp.listCaptureSources();
  } catch (error) {
    shareDialog.sources = [];
    showToast(`Erro listando telas: ${error.message}`, 'error');
  }
  const selectedStillExists = shareDialog.selectedSource && shareDialog.sources.some((source) => source.id === shareDialog.selectedSource.id);
  if (!selectedStillExists) {
    shareDialog.selectedSource = shareDialog.sources.find((source) => source.kind === shareDialog.activeTab)
      || shareDialog.sources.find((source) => source.kind === 'screen')
      || null;
  }
  renderCaptureSources();
}

function renderCaptureSources() {
  for (const tab of findAllElements('.source-tab')) tab.classList.toggle('active', tab.dataset.tab === shareDialog.activeTab);
  const sourcesInTab = shareDialog.sources.filter((source) => source.kind === shareDialog.activeTab);
  const sourceGrid = findElement('#source-grid');
  if (!sourcesInTab.length) {
    const emptyText = shareDialog.activeTab === 'window' ? 'Nenhuma janela encontrada.' : 'Nenhuma tela encontrada.';
    sourceGrid.replaceChildren(createElement('div', { class: 'empty-message' }, emptyText));
  } else {
    sourceGrid.replaceChildren(...sourcesInTab.map(createSourceCard));
  }
  showDraftSettings();
  updateConfirmButton();
}

function createSourceCard(source) {
  const isSelected = shareDialog.selectedSource && shareDialog.selectedSource.id === source.id;
  return createElement('div', {
    class: `source-card${isSelected ? ' selected' : ''}`,
    title: source.name,
    onclick: () => selectCaptureSource(source),
    ondblclick: () => {
      selectCaptureSource(source);
      confirmShareDialog();
    },
  },
  createElement('div', { class: 'source-thumbnail', style: source.thumbnailDataUrl ? `background-image:url(${source.thumbnailDataUrl})` : '' }),
  createElement('div', { class: 'source-card-footer' },
    source.iconDataUrl ? createElement('img', { src: source.iconDataUrl }) : '',
    createElement('div', { class: 'source-card-name' }, source.name),
    source.detail ? createElement('div', { class: 'source-card-detail' }, source.detail) : ''));
}

function selectCaptureSource(source) {
  shareDialog.selectedSource = source;
  renderCaptureSources();
}

function showDraftSettings() {
  const settings = shareDialog.draftSettings;
  const highlightSelected = (containerSelector, value) => {
    for (const button of findAllElements(`${containerSelector} button`)) button.classList.toggle('selected', button.dataset.value === String(value));
  };
  highlightSelected('#resolution-options', settings.resolution);
  highlightSelected('#fps-options', settings.framesPerSecond);
  highlightSelected('#priority-options', settings.priority);
  findElement('#bitrate-slider').value = settings.bitrateMegabits;
  findElement('#bitrate-value').textContent = `${Number(settings.bitrateMegabits).toFixed(1)} Mbps`;
  findElement('#share-audio-checkbox').checked = Boolean(settings.shareAudio);
  findElement('#codec-select').value = settings.codec;
  findElement('#upload-limit-input').value = settings.uploadLimitMegabits;

  const selectedKind = shareDialog.selectedSource ? shareDialog.selectedSource.kind : 'screen';
  findElement('#exclude-discord-checkbox').checked = settings.excludeDiscordAudio !== false;
  findElement('#exclude-discord-option').classList.toggle('hidden', selectedKind === 'window' || !settings.shareAudio);
  findElement('#share-audio-hint').textContent = selectedKind === 'window'
    ? 'Só o áudio desse programa.'
    : 'Todo o som do PC, menos o do próprio Telinha (pra não dar eco de quem você está assistindo).';
}

function updateConfirmButton() {
  findElement('#confirm-share-button').disabled = SHARE_DIALOG_MODES[shareDialog.mode].showsSourcePicker && !shareDialog.selectedSource;
}

async function confirmShareDialog() {
  const settings = normalizeShareSettings(shareDialog.draftSettings);
  appState.shareSettings = settings;
  savedPreferences.write('shareSettings', settings);
  closeShareDialog();

  if (shareDialog.mode === 'start') await startBroadcast(shareDialog.selectedSource, settings);
  if (shareDialog.mode === 'switch') await switchBroadcastSource(shareDialog.selectedSource, settings);
  if (shareDialog.mode === 'adjust') await adjustBroadcastQuality(settings);
}

async function adjustBroadcastQuality(settings) {
  if (!appState.myBroadcast) return;
  const captureWasUpdated = await appState.myBroadcast.updateSettings(settings);
  showBroadcastStats(appState.myBroadcast.latestStats);
  if (captureWasUpdated) showToast('Qualidade atualizada.', 'ok');
  else showToast('Bitrate atualizado, mas não deu pra mudar a resolução agora.', 'warn');
}
