import { CHAINS, getChainKeyById } from 'indelible';

function wrapper() {
    return document.querySelector('.settings-wrapper');
}

function updateTestnetIndicator(chainSelect) {
    const isTestnet = CHAINS[chainSelect.value]?.testnet === true;
    wrapper()?.classList.toggle('testnet', isTestnet);
    const badge = document.getElementById('testnetBadge');
    if (badge) badge.hidden = !isTestnet;
}

function shakeSettings() {
    const el = wrapper();
    if (!el) return;
    el.classList.remove('shake');
    void el.offsetWidth; // restart the animation
    el.classList.add('shake');
    el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
}

/** Keeps the Settings box red while a testnet is selected. */
export function watchTestnet(chainSelect) {
    if (!chainSelect) return;
    updateTestnetIndicator(chainSelect);
    chainSelect.addEventListener('change', () => updateTestnetIndicator(chainSelect));
}

/**
 * Switches the chain by numeric chainId on behalf of the user (URL, PDF, proof file).
 * Shakes the Settings box if the selection actually changed.
 */
export function setChainById(chainSelect, chainId) {
    const key = getChainKeyById(Number(chainId));
    if (!key || key === chainSelect.value) return false;
    chainSelect.value = key;
    chainSelect.dispatchEvent(new Event('change', { bubbles: true }));
    shakeSettings();
    return true;
}
