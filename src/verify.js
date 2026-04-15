import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { createPublicClient, http, toHex } from 'viem'
import { mainnet, arbitrum, base, sepolia } from 'viem/chains'
import taanqAbi from './assets/contractAbi/taanqAbi.json'
import { hashContent, createRawCIDv1, buildTree, dnsEncodeName, decodeCidToIpfsHash } from '/src/utils.js';

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


const authorityField = document.getElementById('authorityInput');

const verifyStatus = document.getElementById('verifyStatus');
const verifyResult = document.getElementById('verifyResult');
const verifyHeading = document.getElementById('verifyHeading');
const verifyDetails = document.getElementById('verifyDetails');



async function cidToAttestationIndices(ipfsHash, indexOfAttestationIndex) {
    let attestationIndex = 0;
    //try {
    attestationIndex = await client.readContract({
            address: taanqAddress,
            abi: taanqAbi,
            functionName: 'cidToAttestationIndices',
            args: [ipfsHash, indexOfAttestationIndex],
        });
    //} catch (ContractFunctionExecutionError) {
    //    attestationIndex = 0;
    //}

    return attestationIndex
}

async function getAttestationByIndex(index) {
    //let attestationIndex = 0;
    //try {
    let attestationIndex = await client.readContract({
            address: taanqAddress,
            abi: taanqAbi,
            functionName: 'attestations',
            args: [index],
        });
    //} catch (ContractFunctionExecutionError) {
    //    attestationIndex = 0;
    //}

    return attestationIndex
}

async function cidAndAddressToAttestationIndices(ipfsHash, address) {
    let attestationIndex = 0;
    try {
        attestationIndex = await client.readContract({
                address: taanqAddress,
                abi: taanqAbi,
                functionName: 'cidAndAddressToAttestationIndices',
                args: [ipfsHash, address],
            });
    } catch (ContractFunctionExecutionError) {
        attestationIndex = 0;
    }

    return attestationIndex
}

const verifyButton = document.getElementById('verifyButton');
verifyButton.addEventListener('click', async function(event) {
    event.preventDefault()

    const cid = cidField.value;
    const authority = authorityField.value;

    const ipfsHash = decodeCidToIpfsHash(cid);

    let firstAttestationIndex = 0;


    firstAttestationIndex = await cidToAttestationIndices(ipfsHash, 0);
    

    if (firstAttestationIndex == 0) {
        verifyResult.hidden = false;
        verifyHeading.textContent = "No Attestation Found";
        verifyDetails.textContent = "This text/CID has not yet been published to the Indelible Protocol."
        return
    }

    const firstAttestation = await getAttestationByIndex(firstAttestationIndex);
    console.log(firstAttestation);
    verifyResult.hidden = false;
    verifyHeading.textContent = "Attestation Found";
    verifyDetails.textContent = `This text/CID has been published to the Indelible Protocol by ${firstAttestation[3]} at timestamp ${firstAttestation[4]}.`
    return


    if (authority) {
        const authorityAttestationIndex = cidAndAddressToAttestationIndices(ipfsHash, authority);
        
    }
});