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

articleInput.addEventListener('input', async function(event) {
    console.log('Current text:', event.target.value);
    const hashData = new TextEncoder().encode(event.target.value);

    const cid = await createRawCIDv1(hashData);
    console.log(cid);
    cidField.value = cid;

});

const continueAttestation = document.getElementById('continueAttestation');
