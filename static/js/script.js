// static/js/script.js
document.addEventListener('DOMContentLoaded', () => {
  const urlForm = document.getElementById('url-form');
  const downloadForm = document.getElementById('download-form');
  const statusArea = document.getElementById('status-area');
  const step2Div = document.getElementById('step2-download');
  const fetchBtn = document.getElementById('fetch-btn');
  const youtubeUrlInput = document.getElementById('youtube-url');
  const downloadBtn = document.getElementById('download-btn');
  const openBtn = document.getElementById('open-btn');
  let currentVideoInfo = null;

  function showLoader() {
    statusArea.innerHTML = '<div class="loader"></div>';
  }
  function clearStatus(){ statusArea.innerHTML = ''; }
  function displayError(msg){
    statusArea.innerHTML = `<div class="alert-error">${msg}</div>`;
  }
  function displayInfo(msg){
    statusArea.innerHTML = `<div class="alert-info">${msg}</div>`;
  }

  function showStep2() {
    step2Div.classList.remove('hidden');
    // force reflow for transition; then add visible
    void step2Div.offsetWidth;
    step2Div.classList.add('visible');
  }
  function hideStep2() {
    step2Div.classList.remove('visible');
    step2Div.classList.add('hidden');
  }

  urlForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const url = youtubeUrlInput.value.trim();
    if (!url) return displayError('Please paste a YouTube URL.');

    fetchBtn.disabled = true;
    clearStatus();
    hideStep2();
    showLoader();

    try {
      const resp = await fetch('/get_info', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ url })
      });
      const data = await resp.json();
      clearStatus();
      if (!resp.ok) {
        displayError(data.error || 'Failed to fetch video info.');
        return;
      }
      currentVideoInfo = data;
      populateFormats(data);
      showStep2();
    } catch (err) {
      clearStatus();
      displayError('Could not connect to server. Is it running?');
    } finally {
      fetchBtn.disabled = false;
    }
  });

  document.getElementById('clear-btn').addEventListener('click', () => {
    youtubeUrlInput.value = '';
    clearStatus();
    hideStep2();
    currentVideoInfo = null;
  });

  function populateFormats(data){
    const formatSelect = document.getElementById('format-select');
    formatSelect.innerHTML = '';
    document.getElementById('video-thumbnail').src = data.thumbnail || '';
    document.getElementById('video-title').textContent = data.title || '';

    if (!data.formats || data.formats.length === 0) {
      const opt = document.createElement('option');
      opt.textContent = 'No formats found';
      opt.disabled = true;
      formatSelect.appendChild(opt);
      return;
    }

    data.formats.forEach(f => {
      const option = document.createElement('option');
      option.value = f.id;
      option.textContent = f.label;
      option.dataset.ext = f.ext || 'mp4';
      formatSelect.appendChild(option);
    });
  }

  // open in new tab (direct url) - tries same logic as download but only for direct URLs
  openBtn.addEventListener('click', async () => {
    if (!currentVideoInfo) return displayError('Fetch a video first.');
    const format = document.getElementById('format-select').value;
    try {
      displayInfo('Opening direct stream if available...');
      const resp = await fetch('/download', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ url: youtubeUrlInput.value.trim(), format_id: format })
      });

      const contentType = resp.headers.get('content-type') || '';
      if (!resp.ok) {
        const err = await resp.json().catch(()=>({error:'Unknown error'}));
        displayError(err.error || 'Failed to get link');
        return;
      }

      if (contentType.includes('application/json')) {
        const data = await resp.json();
        if (data.download_url) {
          window.open(data.download_url, '_blank');
        } else {
          displayError('Direct link not available.');
        }
      } else {
        // It's a file blob -> open in new tab after creating object url
        const blob = await resp.blob();
        const urlObj = URL.createObjectURL(blob);
        window.open(urlObj, '_blank');
        // revoke after some time
        setTimeout(()=>URL.revokeObjectURL(urlObj), 60_000);
      }
    } catch (e) {
      displayError('Could not reach server to open link.');
    }
  });

  // Download handler: supports JSON direct-link OR blob response
  downloadForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!currentVideoInfo) return displayError('Fetch a video first.');

    downloadBtn.disabled = true;
    showLoader();

    const formatSelect = document.getElementById('format-select');
    const formatId = formatSelect.value;
    const fileExt = formatSelect.options[formatSelect.selectedIndex].dataset.ext || 'mp4';
    const safeTitle = (currentVideoInfo.title || 'video').replace(/[\\/:*?"<>|]/g, '');
    try {
      const resp = await fetch('/download', {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({ url: youtubeUrlInput.value.trim(), format_id: formatId })
      });

      if (!resp.ok) {
        // try json error
        const err = await resp.json().catch(()=>({error:'Server error'}));
        clearStatus();
        displayError(err.error || 'Download failed.');
        return;
      }

      const contentType = resp.headers.get('content-type') || '';

      if (contentType.includes('application/json')) {
        const data = await resp.json();
        clearStatus();
        if (data.download_url) {
          const a = document.createElement('a');
          a.href = data.download_url;
          a.download = `${safeTitle}.${fileExt}`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          displayInfo('Download started (direct link).');
        } else {
          displayError('No direct download link returned.');
        }
      } else {
        // server returned file blob
        const blob = await resp.blob();
        const cd = resp.headers.get('content-disposition');
        let filename = `${safeTitle}.${fileExt}`;
        if (cd) {
          const m = /filename\*?=(?:UTF-8'')?["']?([^;"']+)/i.exec(cd);
          if (m && m[1]) filename = decodeURIComponent(m[1]);
        }
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        clearStatus();
        displayInfo('Server-side download complete.');
      }
    } catch (err) {
      clearStatus();
      displayError('Connection error during download.');
    } finally {
      downloadBtn.disabled = false;
    }
  });

});
