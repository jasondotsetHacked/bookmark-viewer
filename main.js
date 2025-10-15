// Reuse the clock from the main page
function updateClock() {
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, '0');
  const minutes = String(now.getMinutes()).padStart(2, '0');
  const seconds = String(now.getSeconds()).padStart(2, '0');
  document.getElementById('clock').innerText = `${hours}:${minutes}:${seconds}`;
}
setInterval(updateClock, 1000);
updateClock();

// Minimal placeholder app; replace with your real implementation
const appRoot = document.getElementById('app');

// Example: render a simple list from a JSON blob or query string
function render(data) {
  appRoot.innerHTML = '';

  if (!data || data.length === 0) {
    appRoot.innerHTML = '<p class="crt-text">No bookmarks to display.</p>';
    return;
  }

  const ul = document.createElement('ul');
  for (const item of data) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = item.url;
    a.textContent = item.title || item.url;
    a.target = '_blank';
    li.appendChild(a);
    ul.appendChild(li);
  }
  appRoot.appendChild(ul);
}

// Accept ?data=<base64-encoded-json> for quick experiments
try {
  const params = new URLSearchParams(window.location.search);
  const b64 = params.get('data');
  if (b64) {
    const json = atob(b64);
    const parsed = JSON.parse(json);
    render(parsed);
  } else {
    // Default demo data
    render([
      { title: 'setHacked', url: 'https://sethacked.com/' },
      { title: 'GitHub', url: 'https://github.com/' }
    ]);
  }
} catch (e) {
  appRoot.innerHTML = `<pre style="white-space: pre-wrap;">Error: ${e}</pre>`;
}
