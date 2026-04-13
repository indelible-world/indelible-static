export async function hashContent(data) {
    if (typeof data === 'string') {
        data = new TextEncoder().encode(data);
    }
    const digest = new Uint8Array(
        await crypto.subtle.digest('SHA-256', data)
    );
    return digest;
}

export async function hexHashContent(data) {
    return toHex(hashContent(data));
}

async function encodeText(text) {
    return new TextEncoder().encode(text);
}

export async function createRawCIDv1(data) {
    // 1. Hash the data with SHA-256 (Web Crypto API)
    const digest = await hashContent(data);

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

const merkleSplit = 46;

export function buildTree(text) {
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

export function dnsEncodeName(name) {
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