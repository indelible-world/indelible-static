// Persists the user's last-selected chain across the verify (index.html) and
// publish (publish.html) pages via localStorage.

import { watchTestnet } from './chain-indicator.js';

const STORAGE_KEY = 'indelible:lastChain';

/**
 * Restores `chainSelect`'s value from a previous session (if still a valid
 * option) and wires it up to persist future selections.
 */
export function persistChainSelect(chainSelect) {
    if (!chainSelect) return;

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && [...chainSelect.options].some((option) => option.value === saved)) {
        chainSelect.value = saved;
    }

    chainSelect.addEventListener('change', () => {
        localStorage.setItem(STORAGE_KEY, chainSelect.value);
    });

    watchTestnet(chainSelect);
}
