import { createPublicClient, http, fallback } from 'viem'
import { ens, CHAINS, DEFAULT_RPC_URLS, PUBLIC_RPC_URLS, prettifyTimestamp } from 'indelible'

const chainSelect = document.getElementById('chainSelect');
const rpcInput = document.getElementById('rpcInput');

let client;

function buildClient() {
    const chainKey = chainSelect.value;
    const chain = CHAINS[chainKey] || CHAINS.sepolia;
    const customUrl = rpcInput?.value.trim();

    const transport = customUrl
        ? http(customUrl)
        : fallback([
            http(DEFAULT_RPC_URLS[chainKey] || DEFAULT_RPC_URLS.sepolia),
            http(PUBLIC_RPC_URLS[chainKey] || PUBLIC_RPC_URLS.sepolia),
          ]);

    client = createPublicClient({ chain, transport });
}

chainSelect.addEventListener('change', buildClient);
if (rpcInput) {
    let debounceTimer;
    rpcInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(buildClient, 500);
    });
}

buildClient();

// --- DOM elements ---
const explorerForm = document.getElementById('explorerForm');
const explorerInput = document.getElementById('explorerInput');
const explorerTimestamp = document.getElementById('explorerTimestamp');
const explorerButton = document.getElementById('explorerButton');
const explorerStatus = document.getElementById('explorerStatus');
const explorerResult = document.getElementById('explorerResult');
const explorerHeading = document.getElementById('explorerHeading');
const explorerMeta = document.getElementById('explorerMeta');
const explorerBindings = document.getElementById('explorerBindings');
const showRevokedToggle = document.getElementById('showRevokedToggle');


// --- URL params ---
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('authority')) {
    explorerInput.value = urlParams.get('authority');
}
if (urlParams.has('ens')) {
    explorerInput.value = urlParams.get('ens');
}
if (urlParams.has('timestamp')) {
    explorerTimestamp.value = urlParams.get('timestamp');
}

// Auto-navigate to this tab if authority/ens params present and no other group is targeted
if ((urlParams.has('authority') || urlParams.has('ens')) && !location.hash) {
    location.hash = '#authority-explorer';
    const tabLink = document.querySelector('#mainnav a[data-group="authority-explorer"]');
    if (tabLink) tabLink.click();
}

// --- Contract helpers delegated to indelible.ens ---

function isAddress(input) {
    return /^0x[0-9a-fA-F]{40}$/.test(input);
}

function isEnsName(input) {
    return input.includes('.');
}

function buildExplorerUrl(params) {
    const base = window.location.pathname;
    const search = new URLSearchParams(params);
    return `${base}?${search.toString()}#authority-explorer`;
}

function getTimestampFilter() {
    const value = explorerTimestamp.value.trim();
    if (!value) return null;

    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        throw new Error('Timestamp must be a non-negative Unix timestamp in seconds.');
    }

    return parsed;
}


function makeAddressLink(address) {
    const a = document.createElement('a');
    a.href = buildExplorerUrl({ authority: address });
    a.textContent = address;
    a.title = 'View all ENS bindings for this address';
    return a;
}

function makeEnsLink(ensName) {
    const a = document.createElement('a');
    a.href = buildExplorerUrl({ ens: ensName });
    a.textContent = ensName;
    a.title = 'View ENS binding details';
    return a;
}

function makeEtherscanLink(address) {
    const chainKey = chainSelect.value;
    const baseUrls = {
        ethereum: 'https://etherscan.io/address/',
        sepolia: 'https://sepolia.etherscan.io/address/',
        arbitrum: 'https://arbiscan.io/address/',
        base: 'https://basescan.org/address/',
    };
    const url = (baseUrls[chainKey] || baseUrls.sepolia) + address;
    const a = document.createElement('a');
    a.href = url;
    a.textContent = 'Etherscan ↗';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
}

function makeEnsAppLink(ensName) {
    const a = document.createElement('a');
    a.href = `https://app.ens.domains/${ensName}`;
    a.textContent = 'ENS App ↗';
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
}

// --- Render a single binding card ---
function renderBindingCard(verification, showRevoked, timestamp) {
    const hasTimestampFilter = timestamp !== null;
    const now = Math.floor(Date.now() / 1000);
    const ts = hasTimestampFilter ? timestamp : now;
    const isActive = verification.isActiveAt(ts);
    const isRevoked = verification.endTimestamp !== 0 && verification.endTimestamp <= ts;

    if (hasTimestampFilter && !isActive) return null;
    if (!hasTimestampFilter && isRevoked && !showRevoked) return null;

    const card = document.createElement('div');
    card.className = 'binding-card' + (isRevoked ? ' binding-revoked' : ' binding-active');

    const ensName = verification.name;

    const header = document.createElement('div');
    header.className = 'binding-header';
    const nameEl = document.createElement('strong');
    nameEl.appendChild(makeEnsLink(ensName));
    header.appendChild(nameEl);

    const statusBadge = document.createElement('span');
    statusBadge.className = isRevoked ? 'badge badge-revoked' : 'badge badge-active';
    statusBadge.textContent = isRevoked ? 'Revoked' : 'Active';
    header.appendChild(statusBadge);

    card.appendChild(header);

    const details = document.createElement('ul');
    details.className = 'binding-details';

    const items = [
        { label: 'Authority', value: null, node: makeAddressLink(verification.authority) },
        { label: 'Start', value: prettifyTimestamp(verification.startTimestamp) },
    ];
    if (verification.endTimestamp !== 0) {
        items.push({ label: 'End', value: prettifyTimestamp(verification.endTimestamp) });
    }

    for (const item of items) {
        const li = document.createElement('li');
        const labelSpan = document.createElement('span');
        labelSpan.className = 'binding-label';
        labelSpan.textContent = item.label + ': ';
        li.appendChild(labelSpan);
        if (item.node) {
            li.appendChild(item.node);
        } else {
            li.appendChild(document.createTextNode(item.value));
        }
        details.appendChild(li);
    }

    // Links row
    const linksLi = document.createElement('li');
    linksLi.className = 'binding-links';
    linksLi.appendChild(makeEtherscanLink(verification.authority));
    linksLi.appendChild(document.createTextNode(' · '));
    linksLi.appendChild(makeEnsAppLink(ensName));
    details.appendChild(linksLi);

    card.appendChild(details);
    return card;
}

// --- Main lookup ---
async function performLookup() {
    const input = explorerInput.value.trim();
    if (!input) return;

    explorerStatus.hidden = false;
    explorerStatus.textContent = 'Looking up…';
    explorerResult.hidden = true;
    explorerButton.disabled = true;

    try {
        const showRevoked = showRevokedToggle.checked;
        const ts = getTimestampFilter();

        if (isAddress(input)) {
            await lookupByAddress(input, showRevoked, ts);
        } else if (isEnsName(input)) {
            await lookupByEns(input, showRevoked, ts);
        } else {
            throw new Error('Please enter a valid Ethereum address (0x...) or ENS name (e.g. name.eth).');
        }

        explorerResult.hidden = false;
    } catch (err) {
        explorerHeading.textContent = 'Error';
        explorerMeta.textContent = err.message;
        explorerBindings.innerHTML = '';
        explorerResult.hidden = false;
        console.error(err);
    } finally {
        explorerStatus.hidden = true;
        explorerButton.disabled = false;
    }
}

async function lookupByAddress(address, showRevoked, timestamp) {
    const bindings = await ens.getBindingsByAddress(client, address);

    explorerHeading.textContent = 'ENS Bindings for Address';
    explorerMeta.innerHTML = '';
    const addrSpan = document.createElement('span');
    addrSpan.className = 'explorer-address';
    addrSpan.textContent = address;
    explorerMeta.appendChild(addrSpan);
    explorerMeta.appendChild(document.createTextNode(' '));
    explorerMeta.appendChild(makeEtherscanLink(address));

    if (timestamp !== null) {
        const tsNote = document.createElement('div');
        tsNote.className = 'explorer-ts-note';
        tsNote.textContent = `Checking validity at: ${prettifyTimestamp(timestamp)}`;
        explorerMeta.appendChild(tsNote);
    }

    explorerBindings.innerHTML = '';

    if (bindings.length === 0) {
        explorerBindings.innerHTML = '<p class="no-results">No ENS bindings found for this address.</p>';
        return;
    }

    let renderedCount = 0;
    for (const binding of bindings) {
        const card = renderBindingCard(binding, showRevoked, timestamp);
        if (card) {
            explorerBindings.appendChild(card);
            renderedCount++;
        }
    }

    if (renderedCount === 0) {
        if (timestamp !== null) {
            explorerBindings.innerHTML = '<p class="no-results">No ENS bindings were active at this timestamp.</p>';
        } else {
            explorerBindings.innerHTML = '<p class="no-results">No active ENS bindings found. Enable "Show revoked bindings" to see all.</p>';
        }
    }
}

async function lookupByEns(ensName, showRevoked, timestamp) {
    const verification = await ens.getBindingByName(client, ensName);
    const normalizedName = verification ? verification.name : ensName.trim().toLowerCase();

    explorerHeading.textContent = 'ENS Binding: ' + normalizedName;
    explorerMeta.innerHTML = '';
    explorerMeta.appendChild(makeEnsAppLink(normalizedName));

    if (timestamp !== null) {
        const tsNote = document.createElement('div');
        tsNote.className = 'explorer-ts-note';
        tsNote.textContent = `Checking validity at: ${prettifyTimestamp(timestamp)}`;
        explorerMeta.appendChild(tsNote);
    }

    explorerBindings.innerHTML = '';

    if (!verification) {
        explorerBindings.innerHTML = '<p class="no-results">No Indelible ENS binding found for this name.</p>';
        return;
    }

    // Also resolve the indelible address for this node
    const indelibleAddr = await ens.resolveIndelibleAddress(client, verification.node);
    if (indelibleAddr) {
        const addrNote = document.createElement('div');
        addrNote.className = 'explorer-ts-note';
        addrNote.appendChild(document.createTextNode('Indelible Address: '));
        addrNote.appendChild(makeAddressLink(indelibleAddr));
        explorerMeta.appendChild(addrNote);
    }

    const card = renderBindingCard(verification, showRevoked, timestamp);
    if (card) {
        explorerBindings.appendChild(card);
    } else {
        if (timestamp !== null) {
            explorerBindings.innerHTML = '<p class="no-results">No binding was active at this timestamp.</p>';
        } else {
            explorerBindings.innerHTML = '<p class="no-results">This binding is revoked. Enable "Show revoked bindings" to view.</p>';
        }
    }
}

// --- Event listeners ---
explorerForm.addEventListener('submit', function (e) {
    e.preventDefault();
    performLookup();
});

showRevokedToggle.addEventListener('change', () => {
    if (!explorerResult.hidden) {
        performLookup();
    }
});



// Auto-run if params provided
if (explorerInput.value) {
    // Wait for tab to be activated, then run
    setTimeout(() => performLookup(), 100);
}
