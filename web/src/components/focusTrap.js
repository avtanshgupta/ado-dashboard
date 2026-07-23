export const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function getFocusableElements(container) {
  if (!container) return [];
  return Array.from(container.querySelectorAll(FOCUSABLE_SELECTOR)).filter((el) => (
    !el.disabled
    && !el.hidden
    && el.getAttribute('aria-hidden') !== 'true'
    && typeof el.focus === 'function'
    && el.tabIndex >= 0
  ));
}

export function getTrappedFocusIndex(currentIndex, count, shiftKey = false) {
  if (count <= 0) return -1;
  if (currentIndex < 0) return shiftKey ? count - 1 : 0;
  if (shiftKey) return currentIndex === 0 ? count - 1 : currentIndex - 1;
  return currentIndex === count - 1 ? 0 : currentIndex + 1;
}

export function trapFocus(container, event) {
  if (event.key !== 'Tab') return false;
  const focusable = getFocusableElements(container);
  if (!focusable.length) return false;
  const currentIndex = focusable.indexOf(container.ownerDocument.activeElement);
  const atStart = currentIndex <= 0;
  const atEnd = currentIndex === focusable.length - 1;
  if ((event.shiftKey && !atStart) || (!event.shiftKey && !atEnd && currentIndex !== -1)) return false;
  event.preventDefault();
  focusable[getTrappedFocusIndex(currentIndex, focusable.length, event.shiftKey)]?.focus();
  return true;
}
