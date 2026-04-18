import { StandardMerkleTree } from '@openzeppelin/merkle-tree';
import { createPublicClient, http, toHex, fromHex } from 'viem'
import { mainnet, arbitrum, base, sepolia } from 'viem/chains'
import taanqAbi from './assets/contractAbi/taanqAbi.json'
import { hashContent, createRawCIDv1, getCIDFromHash, getCIDFromRawDigest, buildTree, dnsEncodeName, decodeCidToIpfsHash, prettifyTimestamp } from '/src/utils.js';

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

        const verification = await verifyCid(proofData.ipfsCid, proofData.authority);
        const codeClassMap = { 0: 'result-not-found', 1: 'result-verified', 2: 'result-unverified', 3: 'result-revoked' };
        const primaryCode = verification.resultCode[verification.resultCode.length - 1];

        // Get the merkle root from the authority attestation (last attestation returned)
        const attestation = verification.attestations[verification.attestations.length - 1];
        const merkleRoot = attestation?.qvHash;

        // Verify each proof item and assemble the quote
        let allProofsValid = true;
        const sortedProofs = [...proofData.proof].sort((a, b) => Number(a.value[0]) - Number(b.value[0]));

        if (merkleRoot) {
            for (const item of sortedProofs) {
                const valid = StandardMerkleTree.verify(merkleRoot, ['string', 'string'], item.value, item.proof);
                if (!valid) {
                    allProofsValid = false;
                    break;
                }
            }
        } else {
            allProofsValid = false;
        }

        const quoteText = sortedProofs.map(item => item.value[1]).join('');

        verifyQuoteResult.className = allProofsValid ? codeClassMap[primaryCode] : 'result-unverified';
        verifyQuoteHeading.textContent = allProofsValid ? verification.headline : 'Invalid Proof';
        verifyQuoteText.textContent = quoteText;

        verifyQuoteDetails.innerHTML = '';
        const detailLines = allProofsValid
            ? verification.details
            : ['The Merkle proof could not be verified against the on-chain attestation.'];
        for (const detail of detailLines) {
            const li = document.createElement('li');
            li.textContent = detail;
            verifyQuoteDetails.appendChild(li);
        }

        // Add authority explorer links for quote verification
        if (allProofsValid && verification.attestations.length > 0) {
            const linkLi = document.createElement('li');
            linkLi.style.marginTop = '8px';
            for (const att of verification.attestations) {
                if (att.authority) {
                    const link = document.createElement('a');
                    link.className = 'authority-link';
                    const explorerParams = new URLSearchParams({ authority: att.authority });
                    link.href = `${window.location.pathname}?${explorerParams.toString()}#authority-explorer`;
                    link.textContent = `View ${att.authority.slice(0, 6)}…${att.authority.slice(-4)} in Authority Explorer →`;
                    linkLi.appendChild(link);
                    linkLi.appendChild(document.createElement('br'));
                }
            }
            verifyQuoteDetails.appendChild(linkLi);
        }

        verifyQuoteStatus.hidden = true;
        verifyQuoteResult.hidden = false;
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

// Populate fields from URL params
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('text')) {
    articleInput.value = urlParams.get('text');
    articleInput.dispatchEvent(new Event('input'));
    cidField.value = await createRawCIDv1(urlParams.get('text'));
    cidField.readOnly = true;
} else if (urlParams.has('cid')) {
    cidField.value = urlParams.get('cid');
    cidField.dispatchEvent(new Event('input'));
}

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
if (urlParams.has('authority')) {
    authorityField.value = urlParams.get('authority');
}

const verifyStatus = document.getElementById('verifyStatus');
const verifyResult = document.getElementById('verifyResult');
const verifyHeading = document.getElementById('verifyHeading');
const verifyDetails = document.getElementById('verifyDetails');



async function cidToAttestationIndices(ipfsHash, indexOfAttestationIndex) {
    let attestationIndex = 0;
    try {
        attestationIndex = await client.readContract({
                address: taanqAddress,
                abi: taanqAbi,
                functionName: 'cidToAttestationIndices',
                args: [ipfsHash, indexOfAttestationIndex],
            });
    } catch (ContractFunctionExecutionError) {
        attestationIndex = 0;
    }

    return attestationIndex
}

async function getAttestationByIndex(index) {
    let attestation = 0;
    try {
        attestation = await client.readContract({
                address: taanqAddress,
                abi: taanqAbi,
                functionName: 'attestations',
                args: [index],
            });
    } catch (ContractFunctionExecutionError) {
        attestation = 0;
    }

    return await createAttestationFromRPC(attestation);
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

async function createAttestationFromRPC(rpcResponse) {
    const cid = getCIDFromRawDigest(fromHex(rpcResponse[0], 'bytes'));
    return new Attestation(
        cid,
        rpcResponse[1],
        rpcResponse[2],
        rpcResponse[3],
        rpcResponse[4],
        rpcResponse[5]
    );
}

class Attestation {
    constructor(cid, qvHash, parentIpfsHash, authority, timestamp, revokedAt) {
        this.cid = cid;
        this.qvHash = qvHash;
        this.parentIpfsHash = parentIpfsHash;
        this.authority = authority;
        this.timestamp = timestamp;
        this.revokedAt = revokedAt;
    }
}
class VerificationResult {
    constructor(resultCode, headline, details, attestations) {
        this.resultCode = resultCode;
        this.headline = headline;
        this.details = details;
        this.attestations = attestations;
    }
}

async function verifyCid(cid, authority = null) {
    let resultCode = [];
    let details = [];
    const ipfsHash = decodeCidToIpfsHash(cid);

    let firstAttestationIndex = 0;


    firstAttestationIndex = await cidToAttestationIndices(ipfsHash, 0);
    

    if (firstAttestationIndex == 0) {
        resultCode.push(0);
        if (authority) {
            resultCode.push(2);
        }
        details.push("This text/CID has not yet been published to the Indelible Protocol.");
        return new VerificationResult(
            resultCode,
            "No Attestation Found",
            details,
            []
        );
    }

    const firstAttestation = await getAttestationByIndex(firstAttestationIndex);
    console.log(firstAttestation);


    if (authority) {
        let authorityAttestation = 0;
        if (firstAttestation.authority.toLowerCase() != authority.toLowerCase()) {
            const authorityAttestationIndex = await cidAndAddressToAttestationIndices(ipfsHash, authority);
            if (authorityAttestationIndex == 0) {
                resultCode.push(2);
                details.push(`This text/CID has not yet been published to the Indelible Protocol by ${authority}.`);
                return new VerificationResult(
                    resultCode,
                    "Unverified",
                    details,
                    [firstAttestation]
                );
            }
            details.push(`It was first published to the Indelible Protocol by ${firstAttestation.authority} at ${prettifyTimestamp(firstAttestation.timestamp)}`);
            authorityAttestation = await getAttestationByIndex(authorityAttestationIndex);
        } else {
            authorityAttestation = firstAttestation;
        }

        if (authorityAttestation.revokedAt != 0) {
            resultCode.push(3);
            details.push(`It was revoked at ${prettifyTimestamp(authorityAttestation.revokedAt)}`);
            return new VerificationResult(
                resultCode,
                "Attestation Revoked",
                details,
                [firstAttestation, authorityAttestation]
            );
        }
        resultCode.push(1);
        details.push(`This text/CID has been published to the Indelible Protocol by ${authorityAttestation.authority} at ${prettifyTimestamp(authorityAttestation.timestamp)}.`);
        return new VerificationResult(
            resultCode,
            "Verified",
            details,
            [firstAttestation, authorityAttestation]
        );
        
        

        

        
    } else {
        if (firstAttestation.revokedAt != 0) {
            resultCode.push(3);
            details.push(`It was revoked at ${prettifyTimestamp(firstAttestation.revokedAt)}`);
        }
        const attestationDate = prettifyTimestamp(firstAttestation.timestamp);
        resultCode.push(1);
        details.push(`This text/CID has been published to the Indelible Protocol by ${firstAttestation.authority} at ${attestationDate}.`);
        return new VerificationResult(
            resultCode,
            "Attestation Found",
            details,
            [firstAttestation]
        );
    }
}



const verifyButton = document.getElementById('verifyButton');
verifyButton.addEventListener('click', async function(event) {
    event.preventDefault();

    const cid = cidField.value;
    const authority = authorityField.value;

    verifyResult.hidden = true;
    verifyStatus.hidden = false;
    verifyStatus.textContent = 'Verifying…';
    verifyButton.disabled = true;

    const codeClassMap = { 0: 'result-not-found', 1: 'result-verified', 2: 'result-unverified', 3: 'result-revoked' };

    try {
        const verification = await verifyCid(cid, authority);
        const primaryCode = verification.resultCode[verification.resultCode.length - 1];
        verifyResult.className = codeClassMap[primaryCode] ?? '';

        verifyHeading.textContent = verification.headline;

        verifyDetails.innerHTML = '';
        for (const detail of verification.details) {
            const li = document.createElement('li');
            li.textContent = detail;
            verifyDetails.appendChild(li);
        }

        verifyResult.hidden = false;
    } catch (err) {
        verifyResult.className = 'result-not-found';
        verifyHeading.textContent = 'Error';
        verifyDetails.innerHTML = '';
        const li = document.createElement('li');
        li.textContent = err.message;
        verifyDetails.appendChild(li);
        verifyResult.hidden = false;
        console.error(err);
    } finally {
        verifyStatus.hidden = true;
        verifyButton.disabled = false;
    }
});


