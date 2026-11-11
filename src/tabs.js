import './main.css'

// Main nav: show/hide sub-navbars
document.querySelectorAll('#mainnav a').forEach(link => {
    link.addEventListener('click', function (e) {
        e.preventDefault();
        const group = this.dataset.group;

        // Update active state on main nav
        document.querySelector('#mainnav a.active')?.classList.remove('active');
        this.classList.add('active');

        // Show the matching subnav, hide others
        document.querySelectorAll('.subnav').forEach(nav => nav.classList.remove('active'));
        const subnav = document.getElementById('subnav-' + group);
        if (subnav) {
            subnav.classList.add('active');
            // Click the first sub-link by default
            const firstLink = subnav.querySelector('a');
            if (firstLink) {
                firstLink.click();
            }
        } else {
            // No subnav (e.g. ENS) — navigate directly
            location.hash = '#' + group;
        }
    });
});

// Sub nav: update active state and navigate
document.querySelectorAll('.subnav a').forEach(link => {
    link.addEventListener('click', function () {
        // Update active within this subnav
        this.closest('.subnav').querySelectorAll('a').forEach(a => a.classList.remove('active'));
        this.classList.add('active');
    });
});

// Initialize: show first tab on load
if (!location.hash) {
    document.querySelector('#mainnav a')?.click();
} else {
    // Figure out which group the hash belongs to and activate it
    const hash = location.hash.slice(1);
    // Try exact match first, then fall back to prefix match
    let mainLink = document.querySelector('#mainnav a[data-group="' + hash + '"]');
    if (!mainLink) {
        const group = hash.split('-')[0];
        mainLink = document.querySelector('#mainnav a[data-group="' + group + '"]');
    }
    if (mainLink) {
        mainLink.click();
        // Then activate the specific sub-link
        const subLink = document.querySelector('.subnav a[href="#' + hash + '"]');
        if (subLink) subLink.click();
    }
}

const settingsToggle = document.getElementById('settingsToggle');
const settingsDropdown = document.getElementById('settingsDropdown');


const rpcInput = document.getElementById('rpcInput');

// Empty means "use the default RPC".
function isValidRpc() {
    if (!rpcInput) return true;
    const value = rpcInput.value.trim();
    if (!value) return true;
    try {
        return ['http:', 'https:', 'ws:', 'wss:'].includes(new URL(value).protocol);
    } catch {
        return false;
    }
}

function updateRpcValidity() {
    rpcInput?.classList.toggle('invalid', !isValidRpc());
}

rpcInput?.addEventListener('input', updateRpcValidity);

function closeSettings() {
    if (!isValidRpc()) {
        updateRpcValidity();
        return;
    }
    settingsDropdown.classList.remove('open');
}

settingsToggle.addEventListener('click', () => {
    if (settingsDropdown.classList.contains('open')) {
        closeSettings();
    } else {
        settingsDropdown.classList.add('open');
    }
});

document.addEventListener('click', (e) => {
    if (!settingsDropdown.contains(e.target) && e.target !== settingsToggle) {
        closeSettings();
    }
});