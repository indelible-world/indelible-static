document.querySelectorAll('.topnav a').forEach(link => {
  link.addEventListener('click', function () {
    document.querySelector('.topnav a.active')?.classList.remove('active');
    this.classList.add('active');
  });
});

if (!location.hash) {
    location.hash = '#attestations-attest';
}