const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const BUILDOMAT_BASE = 'https://buildomat.eng.oxide.computer/public';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_API = 'https://api.github.com';
const DOWNLOAD_DIR = process.env.DOWNLOAD_DIR || '';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const activeDownloads = new Map();

const LOCAL_NAMES = {
  'repo.zip': 'tuf-mupdate.zip',
  'manifest.toml': 'manifest.toml',
  'repo.zip.sha256.txt': 'tuf-mupdate.zip.sha256.txt',
};

app.get('/api/commits', async (req, res) => {
  try {
    const page = req.query.page || 1;
    const perPage = req.query.per_page || 30;
    const branch = req.query.branch || 'main';
    const url = `${GITHUB_API}/repos/oxidecomputer/omicron/commits?sha=${branch}&page=${page}&per_page=${perPage}`;
    const headers = {
      'Accept': 'application/vnd.github.v3+json',
      'User-Agent': 'omicron-tuf-browser',
    };
    if (GITHUB_TOKEN) headers['Authorization'] = `Bearer ${GITHUB_TOKEN}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) {
      const text = await resp.text();
      return res.status(resp.status).json({ error: text });
    }
    const commits = await resp.json();
    const linkHeader = resp.headers.get('link');
    const pagination = parseLinkHeader(linkHeader);
    const simplified = commits.map(c => ({
      sha: c.sha,
      shortSha: c.sha.substring(0, 12),
      message: c.commit.message.split('\n')[0],
      author: c.commit.author.name,
      date: c.commit.author.date,
      url: c.html_url,
    }));
    res.json({ commits: simplified, pagination });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/serve/:commit/:file', (req, res) => {
  if (!DOWNLOAD_DIR) return res.status(400).json({ error: 'DOWNLOAD_DIR not configured' });

  const { commit, file } = req.params;
  if (!LOCAL_NAMES[file]) return res.status(400).json({ error: 'Invalid file' });

  const shortSha = commit.substring(0, 12);
  const localName = LOCAL_NAMES[file];
  const filePath = path.join(DOWNLOAD_DIR, shortSha, localName);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not on NAS' });
  }

  const stat = fs.statSync(filePath);
  res.setHeader('Content-Disposition', `attachment; filename="${localName}"`);
  res.setHeader('Content-Length', stat.size);
  res.setHeader('Content-Type', 'application/octet-stream');
  fs.createReadStream(filePath).pipe(res);
});

app.get('/api/latest-commit', async (req, res) => {
  try {
    const resp = await fetch(`${BUILDOMAT_BASE}/branch/oxidecomputer/omicron/main`);
    if (!resp.ok) throw new Error(`Buildomat returned ${resp.status}`);
    const commit = (await resp.text()).trim();
    res.json({ commit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/tuf-status/:commit', async (req, res) => {
  try {
    const { commit } = req.params;
    const base = `${BUILDOMAT_BASE}/file/oxidecomputer/omicron/rot-all/${commit}`;

    const shaResp = await fetch(`${base}/repo.zip.sha256.txt`);
    if (!shaResp.ok) {
      return res.json({
        available: false, commit,
        message: 'TUF repo not available — CI job may not have completed',
      });
    }
    const sha256 = (await shaResp.text()).trim();

    const [repoHead, manifestHead] = await Promise.all([
      fetch(`${base}/repo.zip`, { method: 'HEAD' }).catch(() => null),
      fetch(`${base}/manifest.toml`, { method: 'HEAD' }).catch(() => null),
    ]);

    const repoSize = repoHead?.ok ? parseInt(repoHead.headers.get('content-length') || '0') : null;
    const manifestSize = manifestHead?.ok ? parseInt(manifestHead.headers.get('content-length') || '0') : null;

    let manifest = null;
    if (manifestHead?.ok) {
      const manifestResp = await fetch(`${base}/manifest.toml`);
      if (manifestResp.ok) manifest = await manifestResp.text();
    }

    let dvtDockCommit = null;
    try {
      const dvtResp = await fetch(
        `https://raw.githubusercontent.com/oxidecomputer/omicron/${commit}/tools/dvt_dock_version`,
        { headers: GITHUB_TOKEN ? { Authorization: `Bearer ${GITHUB_TOKEN}` } : {} }
      );
      if (dvtResp.ok) {
        const text = await dvtResp.text();
        const match = text.match(/=(.+)/);
        if (match) dvtDockCommit = match[1].trim();
      }
    } catch (e) { /* ignore */ }

    const onDisk = {};
    if (DOWNLOAD_DIR) {
      const commitDir = path.join(DOWNLOAD_DIR, commit.substring(0, 12));
      for (const [remote, local] of Object.entries(LOCAL_NAMES)) {
        onDisk[remote] = fs.existsSync(path.join(commitDir, local));
      }
    }

    res.json({
      available: true, commit, sha256, manifest, dvtDockCommit,
      repoSize, manifestSize, onDisk,
      downloadDirConfigured: !!DOWNLOAD_DIR,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/download/:commit/:file', async (req, res) => {
  const { commit, file } = req.params;
  if (!LOCAL_NAMES[file]) return res.status(400).json({ error: 'Invalid file' });

  const url = `${BUILDOMAT_BASE}/file/oxidecomputer/omicron/rot-all/${commit}/${file}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) return res.status(resp.status).json({ error: `Buildomat returned ${resp.status}` });

    const filename = file === 'repo.zip' ? `tuf-mupdate-${commit.substring(0, 12)}.zip` : file;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', resp.headers.get('content-type') || 'application/octet-stream');
    const contentLength = resp.headers.get('content-length');
    if (contentLength) res.setHeader('Content-Length', contentLength);

    const reader = resp.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
    res.end();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/save-to-disk/:commit/:file', async (req, res) => {
  if (!DOWNLOAD_DIR) return res.status(400).json({ error: 'DOWNLOAD_DIR not configured' });

  const { commit, file } = req.params;
  if (!LOCAL_NAMES[file]) return res.status(400).json({ error: 'Invalid file' });

  const shortSha = commit.substring(0, 12);
  const commitDir = path.join(DOWNLOAD_DIR, shortSha);
  const downloadId = `${shortSha}/${file}`;
  const localName = LOCAL_NAMES[file];

  if (activeDownloads.has(downloadId)) return res.json(activeDownloads.get(downloadId));
  if (fs.existsSync(path.join(commitDir, localName))) {
    return res.json({ status: 'complete', path: commitDir, file: localName });
  }

  fs.mkdirSync(commitDir, { recursive: true });
  if (!fs.existsSync(path.join(commitDir, 'omicron_commit'))) {
    fs.writeFileSync(path.join(commitDir, 'omicron_commit'), commit);
  }

  const state = {
    status: 'downloading', commit, file, localName, path: commitDir,
    progress: 0, totalBytes: 0, downloadedBytes: 0, error: null, cancelled: false,
  };
  activeDownloads.set(downloadId, state);

  downloadFileToDisk(commit, file, localName, commitDir, state, downloadId).catch(err => {
    if (!state.cancelled) { state.status = 'error'; state.error = err.message; }
  });

  res.json(state);
});

app.post('/api/cancel-download/:commit/:file', (req, res) => {
  const { commit, file } = req.params;
  const downloadId = `${commit.substring(0, 12)}/${file}`;
  const state = activeDownloads.get(downloadId);
  if (!state) return res.json({ status: 'not_found' });

  state.cancelled = true;
  state.status = 'cancelled';

  const filePath = path.join(state.path, LOCAL_NAMES[file]);
  try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { /* ignore */ }

  activeDownloads.delete(downloadId);
  res.json({ status: 'cancelled' });
});

app.get('/api/save-progress/:commit/:file', (req, res) => {
  const shortSha = req.params.commit.substring(0, 12);
  const downloadId = `${shortSha}/${req.params.file}`;
  const state = activeDownloads.get(downloadId);
  if (!state) {
    if (DOWNLOAD_DIR) {
      const localName = LOCAL_NAMES[req.params.file];
      const commitDir = path.join(DOWNLOAD_DIR, shortSha);
      if (localName && fs.existsSync(path.join(commitDir, localName))) {
        return res.json({ status: 'complete', path: commitDir });
      }
    }
    return res.json({ status: 'unknown' });
  }
  res.json(state);
});

app.get('/api/saved', (req, res) => {
  if (!DOWNLOAD_DIR) return res.json({ configured: false, downloads: [] });
  try {
    if (!fs.existsSync(DOWNLOAD_DIR)) return res.json({ configured: true, downloads: [] });
    const entries = fs.readdirSync(DOWNLOAD_DIR, { withFileTypes: true });
    const downloads = entries
      .filter(e => e.isDirectory())
      .map(e => {
        const dir = path.join(DOWNLOAD_DIR, e.name);
        const files = fs.readdirSync(dir);
        const hasRepo = files.includes('tuf-mupdate.zip');
        let size = 0;
        if (hasRepo) size = fs.statSync(path.join(dir, 'tuf-mupdate.zip')).size;
        return { shortSha: e.name, path: dir, complete: hasRepo, size, files, mtime: fs.statSync(dir).mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
    res.json({ configured: true, downloadDir: DOWNLOAD_DIR, downloads });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

async function downloadFileToDisk(commit, remoteFile, localName, commitDir, state, downloadId) {
  const url = `${BUILDOMAT_BASE}/file/oxidecomputer/omicron/rot-all/${commit}/${remoteFile}`;
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to fetch ${remoteFile}: ${resp.status}`);

    state.totalBytes = parseInt(resp.headers.get('content-length') || '0');
    const filePath = path.join(commitDir, localName);
    const fileStream = fs.createWriteStream(filePath);

    const reader = resp.body.getReader();
    while (true) {
      if (state.cancelled) {
        reader.cancel();
        fileStream.destroy();
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) { /* ignore */ }
        console.log(`Cancelled download of ${remoteFile} for ${commit.substring(0, 12)}`);
        return;
      }
      const { done, value } = await reader.read();
      if (done) break;
      fileStream.write(value);
      state.downloadedBytes += value.length;
      if (state.totalBytes > 0) {
        state.progress = Math.round((state.downloadedBytes / state.totalBytes) * 100);
      }
    }

    await new Promise((resolve, reject) => {
      fileStream.on('finish', resolve);
      fileStream.on('error', reject);
      fileStream.end();
    });

    state.status = 'complete';
    state.progress = 100;
    console.log(`Downloaded ${localName} for ${commit.substring(0, 12)} to ${commitDir}`);
  } catch (err) {
    if (!state.cancelled) {
      state.status = 'error';
      state.error = err.message;
      console.error(`Download failed for ${remoteFile} (${commit.substring(0, 12)}): ${err.message}`);
    }
  }
  setTimeout(() => activeDownloads.delete(downloadId), 60000);
}

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', hasGithubToken: !!GITHUB_TOKEN, downloadDir: DOWNLOAD_DIR || null });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function parseLinkHeader(header) {
  if (!header) return {};
  const links = {};
  const parts = header.split(',');
  for (const part of parts) {
    const match = part.match(/<([^>]+)>;\s*rel="([^"]+)"/);
    if (match) {
      const url = new URL(match[1]);
      links[match[2]] = parseInt(url.searchParams.get('page')) || 1;
    }
  }
  return links;
}

app.listen(PORT, () => {
  console.log(`Omicron TUF Browser running on port ${PORT}`);
  console.log(`GitHub token: ${GITHUB_TOKEN ? 'configured' : 'NOT SET — rate limits will apply'}`);
  console.log(`Download dir: ${DOWNLOAD_DIR || 'NOT SET — save-to-disk disabled'}`);
});
