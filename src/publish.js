import { createWalletClient, createPublicClient, custom, http, encodeFunctionData, parseAbi, keccak256, encodePacked, toHex, pad, namehash } from 'viem';
import { mainnet, arbitrum, base, sepolia } from 'viem/chains';
import { createRawCIDv1, buildTree, dnsEncodeName, hexHashContent, merkleSplit, downloadJson } from '/src/utils.js';

const taanqAddress = "0x111111a2eb2791b3ee98c5a55972576c54b05b46";
const ensAddress = "0x1111113661d1fbd85b6d131beb199063582c2be7";

import taanqAbi from './assets/contractAbi/taanqAbi.json'
import ensAbi from './assets/contractAbi/ensAbi.json'

const ensRegistryAddress = '0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e';
const ensRegistryAbi = parseAbi(['function owner(bytes32 node) view returns (address)']);
const ensResolverAbi = parseAbi([
    'function setText(bytes32 node, string key, string value)'
]);


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

    const cid = await createRawCIDv1(event.target.value);
    console.log(cid);
    cidField.value = cid;

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
    event.preventDefault()
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

    const ipfsHash = await hexHashContent(articleInput.value);   // raw SHA-256 digest as bytes32 hex
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

    try {
        const hash = await walletClient.writeContract({
            address: taanqAddress,
            abi: taanqAbi,
            functionName: 'commit',
            args: [saltedHash]
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
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

    // Capture data before clearing pendingCommit
    const capturedCid = cidField.value;
    const capturedIpfsHash = pendingCommit[2];
    const capturedAuthority = pendingCommit[5];
    const capturedChain = getSelectedChain();

    revealStatus.hidden = false;
    revealStatus.textContent = 'Processing...';
    revealButton.disabled = true;
    downloadAttestationRefButton.hidden = true;

    try {
        const hash = await walletClient.writeContract({
            address: taanqAddress,
            abi: taanqAbi,
            functionName: 'reveal',
            args: pendingCommit
        });

        const publicClient = createPublicClient({
            chain: capturedChain,
            transport: custom(selectedWallet.provider),
        });

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status !== 'success') {
            throw new Error('Reveal transaction failed');
        }

        localStorage.removeItem('pendingCommit');
        pendingCommit = null;
        revealButton.hidden = true;
        revealStatus.hidden = true;
        revealButton.disabled = false;

        // Fetch attestation index for reference download
        const attestationIndex = await publicClient.readContract({
            address: taanqAddress,
            abi: taanqAbi,
            functionName: 'cidAndAddressToAttestationIndices',
            args: [capturedIpfsHash, capturedAuthority],
        });

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

    const cid = await createRawCIDv1(articleText);

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