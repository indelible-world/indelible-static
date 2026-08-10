// ENS bindings only exist on Ethereum L1, so ENS-only tabs restrict the chain
// selector to ethereum/sepolia and fall back to ethereum when an L2 was picked.

export const ENS_CHAIN_KEYS = ['ethereum', 'sepolia'];

export function isEnsChain(chainKey) {
    return ENS_CHAIN_KEYS.includes(chainKey);
}

export function toEnsChainKey(chainKey) {
    return isEnsChain(chainKey) ? chainKey : 'ethereum';
}

/**
 * Forces `chainSelect` onto an ENS-compatible chain and disables the L2 options
 * whenever one of `ensGroups` is the active tab.
 */
export function constrainChainSelectToEns(chainSelect, ensGroups) {
    if (!chainSelect) return;

    const groups = new Set(ensGroups);

    function isEnsTabActive() {
        const hash = location.hash.slice(1);
        if (!hash) return false;
        return groups.has(hash) || groups.has(hash.split('-')[0]);
    }

    function apply() {
        const restrict = isEnsTabActive();

        for (const option of chainSelect.options) {
            if (!isEnsChain(option.value)) option.disabled = restrict;
        }

        if (restrict && !isEnsChain(chainSelect.value)) {
            chainSelect.value = 'ethereum';
            chainSelect.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    window.addEventListener('hashchange', apply);
    chainSelect.addEventListener('change', apply);
    apply();

    return apply;
}
