const TOAST_DURATION_MS = 4000;
const ERROR_TOAST_DURATION_MS = 7000;
const STORAGE_PREFIX = 'telinha.';
const PROPERTIES_SET_DIRECTLY = new Set(['value', 'checked', 'muted', 'srcObject']);

function findElement(selector, root = document) {
  return root.querySelector(selector);
}

function findAllElements(selector, root = document) {
  return [...root.querySelectorAll(selector)];
}

function waitMilliseconds(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function createElement(tagName, attributes, ...children) {
  const element = document.createElement(tagName);
  for (const [name, value] of Object.entries(attributes || {})) {
    if (value === false || value === null || value === undefined) continue;
    if (name === 'class') element.className = value;
    else if (name.startsWith('on') && typeof value === 'function') element.addEventListener(name.slice(2), value);
    else if (PROPERTIES_SET_DIRECTLY.has(name)) element[name] = value;
    else element.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
  return element;
}

const savedPreferences = {
  read(key, fallbackValue) {
    try {
      const storedText = localStorage.getItem(STORAGE_PREFIX + key);
      return storedText === null ? fallbackValue : JSON.parse(storedText);
    } catch {
      return fallbackValue;
    }
  },
  write(key, value) {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value));
  },
};

function showToast(text, kind = 'info') {
  const toast = createElement('div', { class: `toast ${kind}` }, text);
  findElement('#toasts').append(toast);
  setTimeout(() => toast.remove(), kind === 'error' ? ERROR_TOAST_DURATION_MS : TOAST_DURATION_MS);
}

function colorForName(name) {
  let hash = 0;
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 55% 45%)`;
}

function createAvatar(name, isLive) {
  const initial = (name.trim()[0] || '?').toUpperCase();
  return createElement('div', { class: `avatar${isLive ? ' live' : ''}`, style: `background:${colorForName(name)}` }, initial);
}

function formatMegabits(kilobitsPerSecond) {
  return (kilobitsPerSecond / 1000).toFixed(1);
}

function describeResolution(resolutionKey) {
  return resolutionKey === 'native' ? 'Original' : `${resolutionKey}p`;
}

async function copyTextToClipboard(text) {
  await desktopApp.copyToClipboard(text);
  showToast(`Copiado: ${text}`, 'ok');
}
