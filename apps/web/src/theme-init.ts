// Persist appearance only; never store patient data in browser storage.
try {
  if (localStorage.getItem('fmv.theme') === 'dark') {
    document.documentElement.dataset['theme'] = 'dark';
    document.documentElement.classList.add('dark');
    document.documentElement.style.colorScheme = 'dark';
  }
} catch {
  // Storage may be unavailable in privacy-restricted browser contexts.
}
