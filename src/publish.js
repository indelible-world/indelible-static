import { createWalletClient, createPublicClient, custom, http } from 'viem';
import { mainnet, arbitrum, base, sepolia } from 'viem/chains';
import {
    createRawCIDv1,
    hexHashContent,
    decodeCidToIpfsHash,
    downloadJson,
    commitAttestation as libCommitAttestation,
    revealAttestation as libRevealAttestation,
    revokeAttestation as libRevokeAttestation,
    setChildIpfsHash as libSetChildIpfsHash,
    delegate as libDelegate,
    revokeDelegation as libRevokeDelegation,
    proveQuote as libProveQuote,
    registerEnsBinding as libRegisterEnsBinding,
    getExistingAttestationIndex,
    getDelegation,
} from 'indelible';

const articleInput = document.getElementById('articleInput');
const cidField = document.getElementById('cid');
const parentIpfsHashField = document.getElementById('parentIpfsHashInput');
const authorityField = document.getElementById('authorityInput');

articleInput.addEventListener('input', async function(event) {
    if (event.target.value == "") {
        cidField.value = "";
        return
    }

    cidField.value = await createRawCIDv1(event.target.value);
});

const commitAttestationButton = document.getElementById('commitAttestation');
const revealStatus = document.getElementById('revealStatus');
const downloadAttestationRefButton = document.getElementById('downloadAttestationRefButton');
let downloadAttestationRefData = null;

downloadAttestationRefButton.addEventListener('click', function () {
    if (!downloadAttestationRefData) return;
    downloadJson(downloadAttestationRefData, 'attestation-reference.json');
});

const wallets = [];
let selectedWallet = null;
let walletClient = null;
let accounts = [];

window.addEventListener('eip6963:announceProvider', (event) => {
    wallets.push(event.detail); // { info: { name, icon, uuid }, provider }
});

window.dispatchEvent(new Event('eip6963:requestProvider'));

const chainSelect = document.getElementById('chainSelect');

const chains = {
    ethereum: mainnet,
    arbitrum: arbitrum,
    base: base,
    sepolia: sepolia
};

function getSelectedChain() {
    return chains[chainSelect.value] || sepolia;
}

function getPublicClient() {
    return createPublicClient({
        chain: getSelectedChain(),
        transport: custom(selectedWallet.provider),
    });
}

async function ensureCorrectChain() {
    const selectedChain = getSelectedChain();
    const currentChainId = await selectedWallet.provider.request({ method: 'eth_chainId' });

    if (parseInt(currentChainId, 16) !== selectedChain.id) {
        await selectedWallet.provider.request({
            method: 'wallet_switchEthereumChain',
            params: [{ chainId: '0x' + selectedChain.id.toString(16) }],
        });
    }
}

async function connectWallet(walletIndex = 0) {
    if (!wallets.length) throw new Error('No wallets discovered');

    selectedWallet = wallets[walletIndex];
    accounts = await selectedWallet.provider.request({ method: 'eth_requestAccounts' });

    await ensureCorrectChain();

    walletClient = createWalletClient({
        account: accounts[0],
        chain: getSelectedChain(),
        transport: custom(selectedWallet.provider),
    });

    return { accounts, walletClient };
}

async function ensureWallet() {
    if (!walletClient) {
        await connectWallet();
    } else {
        await ensureCorrectChain();
        walletClient = createWalletClient({
            account: accounts[0],
            chain: getSelectedChain(),
            transport: custom(selectedWallet.provider),
        });
    }
}

let pendingCommit = null;

const commitTimer = document.getElementById('commitTimer');
const revealButton = document.getElementById('revealAttestation');

// Restore pending commit from localStorage if available
const stored = localStorage.getItem('pendingCommit');
if (stored) {
    pendingCommit = JSON.parse(stored);
    const revealAt = localStorage.getItem('revealAt');
    if (revealAt) {
        const remaining = Math.ceil((parseInt(revealAt) - Date.now()) / 1000);
        if (remaining > 0) {
            startCommitTimer(remaining);
        } else {
            revealButton.hidden = false;
        }
    } else {
        revealButton.hidden = false;
    }
}

function startCommitTimer(seconds, committed = false) {
    let remaining = seconds;
    commitTimer.hidden = false;
    commitTimer.classList.toggle('loading', committed);
    const prefix = committed ? '✓ Committed — reveal in ' : '';
    commitTimer.textContent = `${prefix}${remaining}s`;
    commitAttestationButton.disabled = true;

    const interval = setInterval(() => {
        remaining--;
        commitTimer.textContent = `${prefix}${remaining}s`;
        if (remaining <= 0) {
            clearInterval(interval);
            commitTimer.hidden = true;
            commitTimer.classList.remove('loading');
            commitAttestationButton.disabled = false;
            revealButton.hidden = false;
            localStorage.removeItem('revealAt');
        }
    }, 1000);
}

commitAttestationButton.addEventListener('click', async function(event) {
    event.preventDefault()
    downloadAttestationRefButton.hidden = true;
    downloadAttestationRefData = null;
    revealStatus.hidden = true;
    revealStatus.classList.remove('success');

    await ensureWallet();

    const authority = authorityField.value !== "" ? authorityField.value : accounts[0];
    const publicClient = getPublicClient();

    // Check if this authority has already attested this CID
    try {
        const ipfsHash = await hexHashContent(articleInput.value);
        const existingIndex = await getExistingAttestationIndex({
            publicClient,
            ipfsHash,
            authority,
        });
        if (existingIndex > 0n) {
            const proceed = confirm(
                'Warning: This authority has already attested this CID. Do you want to proceed anyway?'
            );
            if (!proceed) return;
        }
    } catch (_) {
        // non-fatal: skip check
    }

    // If an authority address was provided, check delegation
    if (authorityField.value !== "" && authority.toLowerCase() !== accounts[0].toLowerCase()) {
        const [delegateAddress, timestamp] = await getDelegation({ publicClient, authority });
        if (delegateAddress.toLowerCase() !== accounts[0].toLowerCase() || timestamp === 0n) {
            alert('Error: You are not delegated to this authority. The authority must delegate to your address first.');
            return;
        }
    }

    commitTimer.hidden = false;
    commitTimer.textContent = 'Processing...';
    commitAttestationButton.disabled = true;

    try {
        const parentIpfsHash = parentIpfsHashField.value || undefined;
        const result = await libCommitAttestation({
            walletClient,
            publicClient,
            content: articleInput.value,
            account: accounts[0],
            authority,
            parentIpfsHash,
        });

        pendingCommit = result.pendingCommit;
        localStorage.setItem('pendingCommit', JSON.stringify(pendingCommit));
        localStorage.setItem('revealAt', (Date.now() + 60000).toString());

        startCommitTimer(60, true);
    } catch (err) {
        commitTimer.hidden = true;
        commitAttestationButton.disabled = false;
        if (err.code === 4001 || err.message?.includes('rejected') || err.message?.includes('denied')) {
            commitTimer.textContent = '';
            alert('Transaction rejected.');
        } else {
            alert('Error: ' + (err.shortMessage || err.message));
        }
    }
});

revealButton.addEventListener('click', async function(event) {
    event.preventDefault()
    await ensureWallet();

    // Capture data before clearing pendingCommit
    const capturedCid = cidField.value;
    const capturedAuthority = pendingCommit[5];
    const capturedChain = getSelectedChain();

    revealStatus.hidden = false;
    revealStatus.classList.remove('success');
    revealStatus.textContent = 'Processing...';
    revealButton.disabled = true;
    downloadAttestationRefButton.hidden = true;

    try {
        const publicClient = getPublicClient();
        const { attestationIndex } = await libRevealAttestation({
            walletClient,
            publicClient,
            pendingCommit,
            account: accounts[0],
        });

        localStorage.removeItem('pendingCommit');
        pendingCommit = null;
        revealButton.hidden = true;
        revealButton.disabled = false;
        revealStatus.classList.add('success');
        revealStatus.textContent = '✓ Attestation successful!';

        downloadAttestationRefData = {
            ipfsCid: capturedCid,
            chainId: capturedChain.id,
            authority: capturedAuthority,
            attestationIndex: Number(attestationIndex),
        };
        downloadAttestationRefButton.hidden = false;
    } catch (err) {
        revealStatus.hidden = true;
        revealButton.disabled = false;
        if (err.code === 4001 || err.message?.includes('rejected') || err.message?.includes('denied')) {
            alert('Transaction rejected.');
        } else {
            alert('Error: ' + (err.shortMessage || err.message));
        }
    }
});

// --- Revoke Attestation ---
const revokeAttestationButton = document.getElementById('revokeAttestationButton');
const revokeAttestationIdInput = document.getElementById('revokeAttestationIdInput');
const revokeAttestationStatus = document.getElementById('revokeAttestationStatus');

revokeAttestationButton.addEventListener('click', async function(event) {
    event.preventDefault();

    const attestationId = revokeAttestationIdInput.value.trim();
    if (!attestationId) {
        alert('Please enter an attestation ID.');
        return;
    }

    await ensureWallet();

    revokeAttestationStatus.hidden = false;
    revokeAttestationStatus.textContent = 'Processing...';
    revokeAttestationButton.disabled = true;

    try {
        await libRevokeAttestation({
            walletClient,
            publicClient: getPublicClient(),
            attestationId,
            account: accounts[0],
        });
        revokeAttestationStatus.textContent = 'Attestation revoked.';
    } catch (err) {
        revokeAttestationStatus.textContent = 'Error: ' + (err.shortMessage || err.message);
    } finally {
        revokeAttestationButton.disabled = false;
    }
});

// --- Set Child IPFS Hash ---
const setChildIpfsHashButton = document.getElementById('setChildIpfsHashButton');
const setChildAttestationIdInput = document.getElementById('setChildAttestationIdInput');
const setChildIpfsHashInput = document.getElementById('setChildIpfsHashInput');
const setChildIpfsHashStatus = document.getElementById('setChildIpfsHashStatus');

setChildIpfsHashButton.addEventListener('click', async function(event) {
    event.preventDefault();

    const attestationId = setChildAttestationIdInput.value.trim();
    const childCid = setChildIpfsHashInput.value.trim();
    if (!attestationId) {
        alert('Please enter an attestation ID.');
        return;
    }
    if (!childCid) {
        alert('Please enter a child IPFS CID.');
        return;
    }

    await ensureWallet();

    let childIpfsHash;
    try {
        childIpfsHash = decodeCidToIpfsHash(childCid);
    } catch (err) {
        alert('Invalid IPFS CID: ' + err.message);
        return;
    }

    setChildIpfsHashStatus.hidden = false;
    setChildIpfsHashStatus.textContent = 'Processing...';
    setChildIpfsHashButton.disabled = true;

    try {
        await libSetChildIpfsHash({
            walletClient,
            publicClient: getPublicClient(),
            attestationId,
            childIpfsHash,
            account: accounts[0],
        });
        setChildIpfsHashStatus.textContent = 'Child IPFS hash set.';
    } catch (err) {
        setChildIpfsHashStatus.textContent = 'Error: ' + (err.shortMessage || err.message);
    } finally {
        setChildIpfsHashButton.disabled = false;
    }
});

// --- Delegate ---
const delegateButton = document.getElementById('delegateButton');
const delegateAddressInput = document.getElementById('delegateAddressInput');
const delegateStatus = document.getElementById('delegateStatus');

delegateButton.addEventListener('click', async function(event) {
    event.preventDefault();

    const delegateAddress = delegateAddressInput.value.trim();
    if (!delegateAddress) {
        alert('Please enter a delegate address.');
        return;
    }

    await ensureWallet();

    delegateStatus.hidden = false;
    delegateStatus.textContent = 'Processing...';
    delegateButton.disabled = true;

    try {
        await libDelegate({
            walletClient,
            publicClient: getPublicClient(),
            delegateAddress,
            account: accounts[0],
        });
        delegateStatus.textContent = 'Delegation successful.';
    } catch (err) {
        delegateStatus.textContent = 'Error: ' + (err.shortMessage || err.message);
    } finally {
        delegateButton.disabled = false;
    }
});

// --- Revoke Delegation ---
const revokeDelegationButton = document.getElementById('revokeDelegationButton');
const revokeDelegationStatus = document.getElementById('revokeDelegationStatus');
const currentDelegateDisplay = document.getElementById('currentDelegateDisplay');
const loadDelegateButton = document.getElementById('loadDelegateButton');

async function loadCurrentDelegate() {
    if (!walletClient) {
        await connectWallet();
    } else {
        await ensureCorrectChain();
    }

    const [delegateAddress, timestamp] = await getDelegation({
        publicClient: getPublicClient(),
        authority: accounts[0],
    });

    if (timestamp === 0n || delegateAddress === '0x0000000000000000000000000000000000000000') {
        currentDelegateDisplay.value = 'No active delegation';
    } else {
        currentDelegateDisplay.value = delegateAddress;
    }
}

loadDelegateButton.addEventListener('click', async function(event) {
    event.preventDefault()
    try {
        await loadCurrentDelegate();
    } catch (err) {
        currentDelegateDisplay.value = 'Error: ' + (err.shortMessage || err.message);
    }
});

revokeDelegationButton.addEventListener('click', async function(event) {
    event.preventDefault();

    await ensureWallet();

    revokeDelegationStatus.hidden = false;
    revokeDelegationStatus.textContent = 'Processing...';
    revokeDelegationButton.disabled = true;

    try {
        await libRevokeDelegation({
            walletClient,
            publicClient: getPublicClient(),
            account: accounts[0],
        });
        revokeDelegationStatus.textContent = 'Delegation revoked.';
        currentDelegateDisplay.value = 'No active delegation';
    } catch (err) {
        revokeDelegationStatus.textContent = 'Error: ' + (err.shortMessage || err.message);
    } finally {
        revokeDelegationButton.disabled = false;
    }
});

const proveQuoteButton = document.getElementById('proveQuoteButton');
const proveArticleInput = document.getElementById('proveArticleInput');
const proveQuoteInput = document.getElementById('proveQuoteInput');
const proveAuthorityInput = document.getElementById('proveAuthorityInput');
const proveQuoteStatus = document.getElementById('proveQuoteStatus');

proveQuoteButton.addEventListener('click', async function(event) {
    event.preventDefault();

    const articleText = proveArticleInput.value;
    const quote = proveQuoteInput.value;
    const authority = proveAuthorityInput.value.trim();

    if (!articleText) {
        alert('Please enter the article text.');
        return;
    }
    if (!quote) {
        alert('Please enter the quote to prove.');
        return;
    }
    if (!authority) {
        alert('Please enter the authority address.');
        return;
    }

    const selectedChain = getSelectedChain();
    proveQuoteStatus.hidden = false;
    proveQuoteStatus.textContent = 'Checking on-chain attestation…';
    proveQuoteStatus.style.color = '';

    let proofJson;
    let onChain = false;
    try {
        const readClient = createPublicClient({ chain: selectedChain, transport: http() });
        const result = await libProveQuote({
            articleText,
            quote,
            authority,
            publicClient: readClient,
            chainId: selectedChain.id,
        });
        proofJson = result.proofJson;
        onChain = result.onChain;
    } catch (err) {
        if (err.message?.includes('Quote not found')) {
            alert(err.message);
            proveQuoteStatus.hidden = true;
            return;
        }
        // Non-fatal: build proof without on-chain reference
        try {
            const result = await libProveQuote({ articleText, quote, authority });
            proofJson = result.proofJson;
        } catch (innerErr) {
            alert(innerErr.message);
            proveQuoteStatus.hidden = true;
            return;
        }
        proveQuoteStatus.textContent = 'Warning: could not check on-chain attestation. The proof file will still download without chain reference fields.';
        proveQuoteStatus.style.color = 'orange';
    }

    if (onChain) {
        proveQuoteStatus.hidden = true;
    } else if (proveQuoteStatus.style.color !== 'orange') {
        proveQuoteStatus.textContent = 'Warning: this article has not been attested on-chain by this authority. The proof file will still download but will not include chain reference fields.';
        proveQuoteStatus.style.color = 'orange';
    }

    // Download as JSON
    const blob = new Blob([JSON.stringify(proofJson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quote-proof.json';
    a.click();
    URL.revokeObjectURL(url);
});

// --- ENS Binding ---
const createBindingButton = document.getElementById('createBindingButton');
const ensNameInput = document.getElementById('ensNameInput');
const bindingStatus = document.getElementById('bindingStatus');

createBindingButton.addEventListener('click', async function(event) {
    event.preventDefault();

    const ensName = ensNameInput.value.trim().toLowerCase();
    if (!ensName || !ensName.includes('.')) {
        alert('Please enter a valid ENS name (e.g. yourname.eth).');
        return;
    }

    await ensureWallet();

    bindingStatus.hidden = false;
    bindingStatus.textContent = 'Registering ENS binding...';
    createBindingButton.disabled = true;

    try {
        await libRegisterEnsBinding({
            walletClient,
            publicClient: getPublicClient(),
            ensName,
            account: accounts[0],
        });
        bindingStatus.textContent = 'ENS binding registered.';
    } catch (err) {
        bindingStatus.textContent = 'Error: ' + (err.shortMessage || err.message);
    } finally {
        createBindingButton.disabled = false;
    }
});
