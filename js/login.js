(() => {
  const form = document.getElementById('loginForm');
  const button = document.getElementById('loginButton');
  const message = document.getElementById('message');
  const environment = document.getElementById('environment');
  const runtime = document.getElementById('runtime');
  let csrfToken = '';

  function showRuntime(info = {}) {
    environment.textContent = info.environmentLabel || '–';
    const parts = [info.version, info.commit, info.buildId].filter(Boolean);
    runtime.textContent = parts.join(' · ');
  }

  async function loadRuntime() {
    try {
      const response = await fetch('api/auth/runtime.php', { cache: 'no-store', credentials: 'same-origin' });
      const result = await response.json();
      if (response.ok && result.ok) showRuntime(result.runtime);
    } catch (_error) {
      environment.textContent = '–';
    }
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    button.disabled = true;
    message.textContent = '';
    try {
      const response = await fetch('api/auth/login.php', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          company: document.getElementById('company').value,
          login: document.getElementById('login').value,
          password: document.getElementById('password').value,
          deviceLabel: navigator.userAgent
        })
      });
      const result = await response.json().catch(() => ({}));
      document.getElementById('password').value = '';
      if (!response.ok || !result.ok) throw new Error('Anmeldung nicht möglich.');
      csrfToken = result.csrfToken || '';
      showRuntime(result.runtime);
      message.style.color = '#176b3a';
      message.textContent = `Angemeldet als ${result.user.displayName}.`;
    } catch (_error) {
      csrfToken = '';
      message.style.color = '#9b1c2b';
      message.textContent = 'Anmeldung nicht möglich.';
    } finally {
      button.disabled = false;
    }
  });

  window.lehrfahrerLoginSession = Object.freeze({
    csrfToken: () => csrfToken
  });
  loadRuntime();
})();
