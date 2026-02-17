# Omicron TUF Browser

A web UI for browsing and downloading [Omicron](https://github.com/oxidecomputer/omicron) TUF repository artifacts from [Buildomat](https://buildomat.eng.oxide.computer).

<img width="1461" height="905" alt="image" src="https://github.com/user-attachments/assets/03fdfa2a-f5bd-43b0-9317-59001660d120" />

## Features

- Browse recent commits on `oxidecomputer/omicron` with GitHub API integration
- See which commits have TUF repo artifacts available
- Download `tuf-mupdate.zip`, `manifest.toml`, and `repo.zip.sha256.txt`
- Optional server-side storage: save artifacts to a NAS or local disk with progress tracking and cancel support
- Serve previously downloaded artifacts directly from disk

## Quick Start

```bash
npm install
GITHUB_TOKEN=ghp_yourtoken node server.js
```

Open `http://localhost:3000`.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | Yes | GitHub personal access token for browsing commits (needs `repo` or `public_repo` scope) |
| `DOWNLOAD_DIR` | No | Path for server-side artifact storage. Enables "Save to NAS" functionality. Each commit's artifacts are saved to `DOWNLOAD_DIR/<commit-sha>/` |
| `PORT` | No | Server port (default: `3000`) |

## Docker

### Build

```bash
docker build -t omicron-tuf-browser .
```

### Run (browser downloads only)

```bash
docker run -d --name omicron-tuf \
  -p 3000:3000 \
  -e GITHUB_TOKEN=ghp_yourtoken \
  omicron-tuf-browser
```

### Run (with server-side storage)

```bash
docker run -d --name omicron-tuf \
  -p 3000:3000 \
  -e GITHUB_TOKEN=ghp_yourtoken \
  -e DOWNLOAD_DIR=/downloads \
  -v /path/to/storage:/downloads \
  omicron-tuf-browser
```

Artifacts are saved to `/path/to/storage/<12-char-commit-sha>/` with the following files:

- `tuf-mupdate.zip` — the TUF repository bundle
- `manifest.toml` — the TUF manifest
- `tuf-mupdate.zip.sha256.txt` — SHA-256 checksum
- `omicron_commit` — full commit hash

## Deploying on TrueNAS Scale

1. Push the image to a container registry (e.g. GHCR) or build locally on TrueNAS
2. Deploy as a **Custom App**:
   - **Image:** `ghcr.io/youruser/omicron-tuf-browser:latest`
   - **Port:** host `30080` → container `30080`
   - **Environment variables:** `GITHUB_TOKEN`, `DOWNLOAD_DIR=/downloads`
   - **Storage:** mount a dataset to `/downloads`
3. Optionally put it behind a reverse proxy (Caddy, nginx, etc.) for HTTPS

### Building for amd64 from Apple Silicon

```bash
docker buildx build --platform linux/amd64 -t ghcr.io/youruser/omicron-tuf-browser:latest --push .
```

## How It Works

The app wraps the public [Buildomat](https://buildomat.eng.oxide.computer/public) API. For a given Omicron commit, TUF artifacts are available at:

```
https://buildomat.eng.oxide.computer/public/file/oxidecomputer/omicron/rot-all/<commit>/
```

The GitHub API is used to list recent commits and provide a browsable interface. No GitHub API access is needed for downloading artifacts.

## License

MIT
