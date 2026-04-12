import './main.css'
import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { createWalletClient, createPublicClient, custom, http, encodeFunctionData, parseAbi, keccak256, encodePacked, toHex, pad, namehash } from 'viem';
import { mainnet, arbitrum, base, sepolia } from 'viem/chains';

const taanqAddress = "0x111111a2eb2791b3ee98c5a55972576c54b05b46";
const ensAddress = "0x1111113661d1fbd85b6d131beb199063582c2be7";

import taanqAbi from './assets/contractAbi/taanqAbi.json'
import ensAbi from './assets/contractAbi/ensAbi.json'

const ensRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ensRegistryAbi = parseAbi(['function owner(bytes32 node) view returns (address)']);
const ensResolverAbi = parseAbi([
    'function setText(bytes32 node, string key, string value)'
]);

async function hashContent(data) {
    const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', data)
    );
    return toHex(digest);
}

async function createRawCIDv1(data) {
    // 1. Hash the data with SHA-256 (Web Crypto API)
    const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', data)
    );

    // 2. Build the CID bytes: version(1) + codec(0x55) + multihash
    //    multihash = hash_func(0x12) + digest_size(0x20) + digest(32 bytes)
    const cid = new Uint8Array(2 + 2 + digest.length);
    cid[0] = 0x01; // CIDv1
    cid[1] = 0x55; // raw multicodec
    cid[2] = 0x12; // sha2-256
    cid[3] = 0x20; // 32 bytes
    cid.set(digest, 4);

    // 3. Encode as base32lower with 'b' multibase prefix
    return 'b' + base32Encode(cid);
}

    // RFC 4648 base32 (lowercase, no padding)
function base32Encode(bytes) {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    let bits = 0, value = 0, output = '';

    for (const byte of bytes) {
        value = (value << 8) | byte;
        bits += 8;
        while (bits >= 5) {
        bits -= 5;
        output += alphabet[(value >>> bits) & 0x1f];
        }
    }
    if (bits > 0) {
        output += alphabet[(value << (5 - bits)) & 0x1f];
    }
    return output;
}

const articleInput = document.getElementById('articleInput');
const cidField = document.getElementById('cid');
const parentIpfsHashField = document.getElementById('parentIpfsHashInput');
const authorityField = document.getElementById('authorityInput');

articleInput.addEventListener('input', async function(event) {
    console.log('Current text:', event.target.value);
    if (event.target.value == "") {
        cidField.value = "";
        return
    }
    const hashData = new TextEncoder().encode(event.target.value);

    const cid = await createRawCIDv1(hashData);
    console.log(cid);
    cidField.value = cid;

});

const merkleSplit = 46;

function buildTree(text) {
    const chunks = [];
    for (let i = 0; i < text.length; i += merkleSplit) {
        chunks.push(text.slice(i, i + merkleSplit))
    }

    const values = chunks.map((chunk, i) => [i.toString(), chunk])
    
    const tree = StandardMerkleTree.of(values, ['string', 'string']);
    console.log('Root:', tree.root);
    console.log('Tree JSON:', JSON.stringify(tree));

    return tree;
}

const commitAttestationButton = document.getElementById('commitAttestation');

const wallets = [];
let selectedWallet = null;
let walletClient = null;
let accounts = [];

window.addEventListener('eip6963:announceProvider', (event) => {
    wallets.push(event.detail); // { info: { name, icon, uuid }, provider }
});

window.dispatchEvent(new Event('eip6963:requestProvider'));

const chainSelect = document.getElementById('chainSelect');
const settingsToggle = document.getElementById('settingsToggle');
const settingsDropdown = document.getElementById('settingsDropdown');

const chains = {
    ethereum: mainnet,
    arbitrum: arbitrum,
    base: base,
    sepolia: sepolia
};

function getSelectedChain() {
    return chains[chainSelect.value] || sepolia;
}

settingsToggle.addEventListener('click', () => {
    settingsDropdown.classList.toggle('open');
});

document.addEventListener('click', (e) => {
    if (!settingsDropdown.contains(e.target) && e.target !== settingsToggle) {
        settingsDropdown.classList.remove('open');
    }
});

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

function generateSalt() {
    const salt = crypto.getRandomValues(new Uint8Array(32));
    return toHex(salt); // bytes32 hex string
}

function buildSaltedHash(ipfsHash, address, salt) {
    const addressBytes32 = pad(address, { size: 32, dir: 'right' });
    return keccak256(
        encodePacked(
            ['bytes32', 'bytes32', 'bytes32'],
            [ipfsHash, addressBytes32, salt]
        )
    );
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

function startCommitTimer(seconds) {
    let remaining = seconds;
    commitTimer.hidden = false;
    commitTimer.textContent = `${remaining}s`;
    commitAttestationButton.disabled = true;

    const interval = setInterval(() => {
        remaining--;
        commitTimer.textContent = `${remaining}s`;
        if (remaining <= 0) {
            clearInterval(interval);
            commitTimer.hidden = true;
            commitAttestationButton.disabled = false;
            revealButton.hidden = false;
            localStorage.removeItem('revealAt');
        }
    }, 1000);
}

commitAttestationButton.addEventListener('click', async function(event) {
    const tree = buildTree(articleInput.value);

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

    const hashData = new TextEncoder().encode(articleInput.value);
    const ipfsHash = await hashContent(hashData);   // raw SHA-256 digest as bytes32 hex
    const qvHash = tree.root;          // merkle root
    const salt = generateSalt();
    let authority = "";
    if (authorityField.value != "") {
        authority = authorityField.value;
    } else {
        authority = accounts[0];
    }

    const saltedHash = buildSaltedHash(ipfsHash, authority, salt);

    const publicClient = createPublicClient({
        chain: getSelectedChain(),
        transport: custom(selectedWallet.provider),
    });

    // Check if this authority has already attested this CID
    const existingIndex = await publicClient.readContract({
        address: taanqAddress,
        abi: taanqAbi,
        functionName: 'cidAndAddressToAttestationIndices',
        args: [ipfsHash, authority],
    });

    if (existingIndex > 0n) {
        const proceed = confirm(
            'Warning: This authority has already attested this CID. Do you want to proceed anyway?'
        );
        if (!proceed) return;
    }

    // If an authority address was provided, check delegation
    if (authorityField.value !== "" && authority.toLowerCase() !== accounts[0].toLowerCase()) {
        const delegation = await publicClient.readContract({
            address: taanqAddress,
            abi: taanqAbi,
            functionName: 'delegations',
            args: [authority],
        });

        const [delegateAddress, timestamp] = delegation;
        if (delegateAddress.toLowerCase() !== accounts[0].toLowerCase() || timestamp === 0n) {
            alert('Error: You are not delegated to this authority. The authority must delegate to your address first.');
            return;
        }
    }

    commitTimer.hidden = false;
    commitTimer.textContent = 'Processing...';
    commitAttestationButton.disabled = true;

    const hash = await walletClient.writeContract({
        address: taanqAddress,
        abi: taanqAbi,
        functionName: 'commit',
        args: [saltedHash]
    });

    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== 'success') {
        commitTimer.hidden = true;
        commitAttestationButton.disabled = false;
        throw new Error('Commit transaction failed');
    }

    let parentIpfsHash = "";
    if (parentIpfsHashField.value == "") {
        parentIpfsHash = '0x' + '00'.repeat(32);
    } else {
        parentIpfsHash = parentIpfsHashField.value;
    }

    pendingCommit = [ saltedHash, salt, ipfsHash, qvHash, parentIpfsHash, authority ];
    localStorage.setItem('pendingCommit', JSON.stringify(pendingCommit));
    localStorage.setItem('revealAt', (Date.now() + 60000).toString());

    startCommitTimer(60);
});

revealButton.addEventListener('click', async function(event) {
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

    const hash = await walletClient.writeContract({
        address: taanqAddress,
        abi: taanqAbi,
        functionName: 'reveal',
        args: pendingCommit
    });

    localStorage.removeItem('pendingCommit');
    pendingCommit = null;
    revealButton.hidden = true;
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

    revokeAttestationStatus.hidden = false;
    revokeAttestationStatus.textContent = 'Processing...';
    revokeAttestationButton.disabled = true;

    try {
        const publicClient = createPublicClient({
            chain: getSelectedChain(),
            transport: custom(selectedWallet.provider),
        });

        const hash = await walletClient.writeContract({
            address: taanqAddress,
            abi: taanqAbi,
            functionName: 'revokeAttestation',
            args: [BigInt(attestationId)]
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
            throw new Error('Revoke transaction failed');
        }

        revokeAttestationStatus.textContent = 'Attestation revoked.';
    } catch (err) {
        revokeAttestationStatus.textContent = 'Error: ' + (err.shortMessage || err.message);
    } finally {
        revokeAttestationButton.disabled = false;
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

    delegateStatus.hidden = false;
    delegateStatus.textContent = 'Processing...';
    delegateButton.disabled = true;

    try {
        const publicClient = createPublicClient({
            chain: getSelectedChain(),
            transport: custom(selectedWallet.provider),
        });

        const hash = await walletClient.writeContract({
            address: taanqAddress,
            abi: taanqAbi,
            functionName: 'delegate',
            args: [delegateAddress]
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
            throw new Error('Delegate transaction failed');
        }

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

    const publicClient = createPublicClient({
        chain: getSelectedChain(),
        transport: custom(selectedWallet.provider),
    });

    const delegation = await publicClient.readContract({
        address: taanqAddress,
        abi: taanqAbi,
        functionName: 'delegations',
        args: [accounts[0]],
    });

    const [delegateAddress, timestamp] = delegation;
    if (timestamp === 0n || delegateAddress === '0x0000000000000000000000000000000000000000') {
        currentDelegateDisplay.value = 'No active delegation';
    } else {
        currentDelegateDisplay.value = delegateAddress;
    }
}

loadDelegateButton.addEventListener('click', async function() {
    try {
        await loadCurrentDelegate();
    } catch (err) {
        currentDelegateDisplay.value = 'Error: ' + (err.shortMessage || err.message);
    }
});

revokeDelegationButton.addEventListener('click', async function(event) {
    event.preventDefault();

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

    revokeDelegationStatus.hidden = false;
    revokeDelegationStatus.textContent = 'Processing...';
    revokeDelegationButton.disabled = true;

    try {
        const publicClient = createPublicClient({
            chain: getSelectedChain(),
            transport: custom(selectedWallet.provider),
        });

        const hash = await walletClient.writeContract({
            address: taanqAddress,
            abi: taanqAbi,
            functionName: 'revokeDelegation',
            args: []
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
            throw new Error('Revoke delegation transaction failed');
        }

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

    // Find the quote's position in the article text
    const quoteStart = articleText.indexOf(quote);
    if (quoteStart === -1) {
        alert('Quote not found in the article text.');
        return;
    }
    const quoteEnd = quoteStart + quote.length;

    // Determine which chunks (by index) the quote spans
    const firstChunk = Math.floor(quoteStart / merkleSplit);
    const lastChunk = Math.floor((quoteEnd - 1) / merkleSplit);

    const tree = buildTree(articleText);

    const matchingProofs = [];
    for (const [i, v] of tree.entries()) {
        const chunkIndex = parseInt(v[0], 10);
        if (chunkIndex >= firstChunk && chunkIndex <= lastChunk) {
            matchingProofs.push({
                value: v,
                proof: tree.getProof(i)
            });
        }
    }

    // Compute CID of the article
    const hashData = new TextEncoder().encode(articleText);
    const cid = await createRawCIDv1(hashData);

    const proofJson = {
        ipfsCid: cid,
        authority: authority,
        proof: matchingProofs
    };

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

function dnsEncodeName(name) {
    const labels = name.replace(/\.$/, '').split('.');
    const parts = [];
    for (const label of labels) {
        const encoded = new TextEncoder().encode(label);
        if (encoded.length === 0 || encoded.length > 63) {
            throw new Error(`Invalid label: "${label}"`);
        }
        parts.push(encoded.length);
        parts.push(...encoded);
    }
    parts.push(0);
    return toHex(new Uint8Array(parts));
}

createBindingButton.addEventListener('click', async function(event) {
    event.preventDefault();

    const ensName = ensNameInput.value.trim().toLowerCase();
    if (!ensName || !ensName.includes('.')) {
        alert('Please enter a valid ENS name (e.g. yourname.eth).');
        return;
    }

    let dnsName;
    try {
        dnsName = dnsEncodeName(ensName);
    } catch (err) {
        alert('Invalid ENS name: ' + err.message);
        return;
    }

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

    bindingStatus.hidden = false;
    bindingStatus.textContent = 'Checking indelible-address record...';
    createBindingButton.disabled = true;

    try {
        const publicClient = createPublicClient({
            chain: getSelectedChain(),
            transport: custom(selectedWallet.provider),
        });

        const node = namehash(ensName);

        // Look up the resolver for this ENS name
        const resolverAddr = await publicClient.getEnsResolver({ name: ensName });
        if (!resolverAddr) {
            throw new Error('No resolver set for this ENS name. Please configure a resolver first.');
        }

        // Check if this name already has an active binding to the current user
        const existingBinding = await publicClient.readContract({
            address: ensAddress,
            abi: ensAbi,
            functionName: 'resolveIndelibleAddress',
            args: [node]
        });

        if (existingBinding && existingBinding.toLowerCase() === accounts[0].toLowerCase()) {
            throw new Error('This ENS name is already bound to your address.');
        }

        // Check if indelible-address text record is set
        const indelibleAddr = await publicClient.getEnsText({ name: ensName, key: 'indelible-address' });

        if (!indelibleAddr) {
            // Verify the user owns this ENS name before writing records
            const owner = await publicClient.readContract({
                address: ensRegistryAddress,
                abi: ensRegistryAbi,
                functionName: 'owner',
                args: [node]
            });

            if (!owner || owner.toLowerCase() !== accounts[0].toLowerCase()) {
                throw new Error('You do not own this ENS name. Only the owner can set the indelible-address record.');
            }

            const shouldSet = confirm(
                'The "indelible-address" text record is not set on your ENS resolver. ' +
                'This is required for the binding to work.\n\n' +
                'Would you like to set it to your current wallet address?\n' +
                accounts[0]
            );
            if (!shouldSet) {
                bindingStatus.textContent = 'Cancelled — indelible-address record required.';
                return;
            }

            bindingStatus.textContent = 'Setting indelible-address record...';
            const setTextHash = await walletClient.writeContract({
                address: resolverAddr,
                abi: ensResolverAbi,
                functionName: 'setText',
                args: [node, 'indelible-address', accounts[0]]
            });

            const setTextReceipt = await publicClient.waitForTransactionReceipt({ hash: setTextHash });
            if (setTextReceipt.status !== 'success') {
                throw new Error('Failed to set indelible-address text record');
            }
        }

        bindingStatus.textContent = 'Registering ENS binding...';
        const hash = await walletClient.writeContract({
            address: ensAddress,
            abi: ensAbi,
            functionName: 'registerEnsBinding',
            args: [dnsName]
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
            throw new Error('ENS binding transaction failed');
        }

        bindingStatus.textContent = 'ENS binding registered.';
    } catch (err) {
        bindingStatus.textContent = 'Error: ' + (err.shortMessage || err.message);
    } finally {
        createBindingButton.disabled = false;
    }
});