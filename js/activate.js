(() => {
  const form = document.getElementById('activationForm');
  const button = document.getElementById('activationButton');
  const message = document.getElementById('message');
  const password = document.getElementById('password');
  const confirmation = document.getElementById('confirmation');
  const fragment = new URLSearchParams(window.location.hash.slice(1));
  // URL fragments are not sent to the server and therefore avoid access-log leaks.
  const token = fragment.get('token') || '';
  window.history.replaceState(null, '', window.location.pathname);

  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
    form.hidden = true;
    message.textContent = 'Aktivierung nicht möglich oder Link nicht mehr gültig.';
    return;
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    button.disabled = true;
    message.textContent = '';
    try {
      const response = await fetch('api/auth/activate.php', {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          password: password.value,
          passwordConfirmation: confirmation.value
        })
      });
      if (!response.ok) throw new Error('activation rejected');
      form.hidden = true;
      message.style.color = '#176b3a';
      message.textContent = 'Konto erfolgreich aktiviert. Sie können sich jetzt anmelden.';
    } catch (_error) {
      message.textContent = 'Aktivierung nicht möglich oder Link nicht mehr gültig.';
    } finally {
      password.value = '';
      confirmation.value = '';
      button.disabled = false;
    }
  });
})();
