import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { createPublicClient, http, toHex } from 'viem'
import { mainnet, arbitrum, base, sepolia } from 'viem/chains'
import taanqAbi from './assets/contractAbi/taanqAbi.json'
import { hashContent, createRawCIDv1, buildTree, dnsEncodeName } from '/src/utils.js';

const taanqAddress = "0x111111a2eb2791b3ee98c5a55972576c54b05b46";

const ALCHEMY_KEY = '3Fxk_v1qhXH-B5SjNWXYo'; // Restricted to just indelible contracts (see https://dashboard.alchemy.com/apps/lby6hxqj8ggxggxh/security)

const chains = {
    ethereum: mainnet,
    arbitrum: arbitrum,
    base: base,
    sepolia: sepolia,
};

const defaultRpcUrls = {
    ethereum: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    arbitrum: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    base: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    sepolia: `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`,
};

const chainSelect = document.getElementById('chainSelect');
const rpcInput = document.getElementById('rpcInput');

let client;

function buildClient() {
    const chainKey = chainSelect.value;
    const chain = chains[chainKey] || sepolia;
    const rpcUrl = rpcInput.value.trim() || defaultRpcUrls[chainKey] || defaultRpcUrls.sepolia;

    client = createPublicClient({
        chain,
        transport: http(rpcUrl),
    });
}

let debounceTimer;
chainSelect.addEventListener('change', buildClient);
rpcInput.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(buildClient, 500);
});

buildClient();

// --- Verify Quote ---

// Decode a base32lower CIDv1 to extract the raw SHA-256 digest as bytes32 hex
function decodeCidToIpfsHash(cid) {
    // Strip 'b' multibase prefix
    const base32 = cid.startsWith('b') ? cid.slice(1) : cid;
    const alphabet = 'abcdefghijklmnopqrstuvwxyz234567';
    let bits = 0, value = 0;
    const bytes = [];
    for (const char of base32) {
        const idx = alphabet.indexOf(char);
        if (idx === -1) throw new Error('Invalid base32 character: ' + char);
        value = (value << 5) | idx;
        bits += 5;
        if (bits >= 8) {
            bits -= 8;
            bytes.push((value >>> bits) & 0xff);
        }
    }
    const raw = new Uint8Array(bytes);
    // CIDv1: version(1) + codec(0x55) + multihash(0x12, 0x20, 32 bytes digest)
    // Skip first 4 bytes (version, codec, hash func, digest size)
    const digest = raw.slice(4);
    return toHex(digest);
}

const verifyQuoteForm = document.getElementById('verifyQuoteForm');
const proofFileInput = document.getElementById('proofFileInput');
const verifyQuoteButton = document.getElementById('verifyQuoteButton');
const verifyQuoteStatus = document.getElementById('verifyQuoteStatus');
const verifyQuoteResult = document.getElementById('verifyQuoteResult');
const verifyQuoteHeading = document.getElementById('verifyQuoteHeading');
const verifyQuoteText = document.getElementById('verifyQuoteText');
const verifyQuoteDetails = document.getElementById('verifyQuoteDetails');

verifyQuoteForm.addEventListener('submit', async function (event) {
    event.preventDefault();

    const file = proofFileInput.files[0];
    if (!file) {
        alert('Please select a proof JSON file.');
        return;
    }

    verifyQuoteStatus.hidden = false;
    verifyQuoteStatus.textContent = 'Verifying...';
    verifyQuoteResult.hidden = true;
    verifyQuoteButton.disabled = true;

    try {
        const text = await file.text();
        const proofData = JSON.parse(text);

        if (!proofData.ipfsCid || !proofData.proof || !Array.isArray(proofData.proof)) {
            throw new Error('Invalid proof file format. Expected ipfsCid and proof array.');
        }

        // Decode CID to bytes32 ipfsHash
        const ipfsHash = decodeCidToIpfsHash(proofData.ipfsCid);


    } catch (err) {
        verifyQuoteStatus.textContent = 'Error: ' + err.message;
        verifyQuoteStatus.style.color = 'red';
        console.error(err);
    } finally {
        verifyQuoteButton.disabled = false;
    }
});


const articleInput = document.getElementById('articleInput');
const cidField = document.getElementById('cid');
const authorityField = document.getElementById('authorityInput');

articleInput.addEventListener('input', async function (event) {
    if (event.target.value != "") {
        cidField.readOnly = true;
        cidField.value = await createRawCIDv1(event.target.value);
    } else {
        cidField.value = "";
        cidField.readOnly = false;
    }
});
cidField.addEventListener('input', async function (event) {
    if (event.target.value != "") {
        articleInput.readOnly = true;
    } else {
        articleInput.readOnly = false;
    }
});