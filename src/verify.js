import { createPublicClient, http } from 'viem'
import { mainnet, arbitrum, base, sepolia } from 'viem/chains'

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
