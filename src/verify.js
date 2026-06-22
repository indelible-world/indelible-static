import { fromHex } from 'viem';
import {
    createRawCIDv1,
    downloadJson,
    verifyCid,
    verifyQuoteProof,
    CHAINS,
    createIndelibleClient,
    getChainKeyById,
    attestationToRef,
    getCIDFromRawDigest,
} from 'indelible';

const chainSelect = document.getElementById('chainSelect');
const rpcInput = document.getElementById('rpcInput');

let client;

function buildClient() {
    client = createIndelibleClient(chainSelect.value, rpcInput.value);
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

        // Auto-switch chain if chainId is embedded in the proof file
        if (proofData.chainId) {
            const chainKey = getChainKeyById(proofData.chainId);
            if (chainKey) {
                chainSelect.value = chainKey;
                buildClient();
            }
        }

        const { verification, quoteText, allProofsValid } = await verifyQuoteProof(client, proofData);

        verifyQuoteResult.className = allProofsValid ? (verification.cssClass ?? '') : 'result-unverified';
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
            const seenAuthorities = new Set();
            for (const att of verification.attestations) {
                if (att.authority && !seenAuthorities.has(att.authority.toLowerCase())) {
                    seenAuthorities.add(att.authority.toLowerCase());
                    const link = document.createElement('a');
                    link.className = 'authority-link';
                    const explorerParams = new URLSearchParams({ authority: att.authority, timestamp: att.timestamp.toString() });
                    link.href = `${window.location.pathname}?${explorerParams.toString()}#authority-explorer`;
                    link.textContent = `View ${att.authority.slice(0, 6)}…${att.authority.slice(-4)} in Authority Explorer →`;
                    linkLi.appendChild(link);
                    linkLi.appendChild(document.createElement('br'));
                }
            }
            verifyQuoteDetails.appendChild(linkLi);
        }

        // Show child hash link if the last attestation has a childIpfsHash
        if (allProofsValid) {
            const lastQuoteAtt = verification.attestations[verification.attestations.length - 1];
            const zeroHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
            if (lastQuoteAtt && lastQuoteAtt.childIpfsHash && lastQuoteAtt.childIpfsHash !== zeroHash) {
                const childCid = getCIDFromRawDigest(fromHex(lastQuoteAtt.childIpfsHash, 'bytes'));
                const childLi = document.createElement('li');
                childLi.style.marginTop = '8px';
                const childLink = document.createElement('a');
                childLink.className = 'authority-link';
                const childParams = new URLSearchParams({ cid: childCid });
                childLink.href = `${window.location.pathname}?${childParams.toString()}`;
                childLink.textContent = `View updated version (child attestation) →`;
                childLi.appendChild(childLink);
                verifyQuoteDetails.appendChild(childLi);
            }
        }

        // Populate download button for the relevant attestation
        const quoteRefAtt = verification.attestations[verification.attestations.length - 1];
        if (allProofsValid && quoteRefAtt && quoteRefAtt.index != null) {
            downloadQuoteRefData = attestationToRef(quoteRefAtt, (CHAINS[chainSelect.value] ?? CHAINS.sepolia).id);
            downloadQuoteRefButton.hidden = false;
        } else {
            downloadQuoteRefButton.hidden = true;
        }

        verifyQuoteStatus.hidden = true;
        verifyQuoteResult.hidden = false;
    } catch (err) {
        verifyQuoteStatus.textContent = 'Error: ' + err.message;
        verifyQuoteStatus.style.color = 'red';
        downloadQuoteRefButton.hidden = true;
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
const downloadVerifyRefButton = document.getElementById('downloadVerifyRefButton');
const downloadQuoteRefButton = document.getElementById('downloadQuoteRefButton');
let downloadVerifyRefData = null;
let downloadQuoteRefData = null;

downloadVerifyRefButton.addEventListener('click', function () {
    if (!downloadVerifyRefData) return;
    downloadJson(downloadVerifyRefData, 'attestation-reference.json');
});

downloadQuoteRefButton.addEventListener('click', function () {
    if (!downloadQuoteRefData) return;
    downloadJson(downloadQuoteRefData, 'attestation-reference.json');
});


const verifyButton = document.getElementById('verifyButton');
verifyButton.addEventListener('click', async function(event) {
    event.preventDefault();

    const cid = cidField.value;
    const authority = authorityField.value;

    verifyResult.hidden = true;
    verifyStatus.hidden = false;
    verifyStatus.textContent = 'Verifying…';
    verifyButton.disabled = true;

    try {
        const verification = await verifyCid(client, cid, authority || null);
        verifyResult.className = verification.cssClass ?? '';

        verifyHeading.textContent = verification.headline;

        verifyDetails.innerHTML = '';
        for (const detail of verification.details) {
            const li = document.createElement('li');
            li.textContent = detail;
            verifyDetails.appendChild(li);
        }

        // Add authority explorer links for each attestation
        if (verification.attestations.length > 0) {
            const linkLi = document.createElement('li');
            linkLi.style.marginTop = '8px';
            const seenAuthorities = new Set();
            for (const att of verification.attestations) {
                if (att.authority && !seenAuthorities.has(att.authority.toLowerCase())) {
                    seenAuthorities.add(att.authority.toLowerCase());
                    const link = document.createElement('a');
                    link.className = 'authority-link';
                    const explorerParams = new URLSearchParams({ authority: att.authority, timestamp: att.timestamp.toString() });
                    link.href = `${window.location.pathname}?${explorerParams.toString()}#authority-explorer`;
                    link.textContent = `View ${att.authority.slice(0, 6)}…${att.authority.slice(-4)} in Authority Explorer →`;
                    linkLi.appendChild(link);
                    linkLi.appendChild(document.createElement('br'));
                }
            }
            verifyDetails.appendChild(linkLi);
        }

        // Show child hash link if the last attestation has a childIpfsHash
        const lastAtt = verification.attestations[verification.attestations.length - 1];
        const zeroHash = '0x0000000000000000000000000000000000000000000000000000000000000000';
        if (lastAtt && lastAtt.childIpfsHash && lastAtt.childIpfsHash !== zeroHash) {
            const childCid = getCIDFromRawDigest(fromHex(lastAtt.childIpfsHash, 'bytes'));
            const childLi = document.createElement('li');
            childLi.style.marginTop = '8px';
            const childLink = document.createElement('a');
            childLink.className = 'authority-link';
            const childParams = new URLSearchParams({ cid: childCid });
            childLink.href = `${window.location.pathname}?${childParams.toString()}`;
            childLink.textContent = `View updated version (child attestation) →`;
            childLi.appendChild(childLink);
            verifyDetails.appendChild(childLi);
        }

        // Populate download button for the relevant attestation
        const refAtt = verification.attestations[verification.attestations.length - 1];
        if (refAtt && refAtt.index != null) {
            downloadVerifyRefData = attestationToRef(refAtt, (CHAINS[chainSelect.value] ?? CHAINS.sepolia).id);
            downloadVerifyRefButton.hidden = false;
        } else {
            downloadVerifyRefButton.hidden = true;
        }

        verifyResult.hidden = false;
    } catch (err) {
        verifyResult.className = 'result-not-found';
        verifyHeading.textContent = 'Error';
        verifyDetails.innerHTML = '';
        const li = document.createElement('li');
        li.textContent = err.message;
        verifyDetails.appendChild(li);
        downloadVerifyRefButton.hidden = true;
        verifyResult.hidden = false;
        console.error(err);
    } finally {
        verifyStatus.hidden = true;
        verifyButton.disabled = false;
    }
});
