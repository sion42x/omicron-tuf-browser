# Omicron TUF Browser

A web UI for browsing and downloading [Omicron](https://github.com/oxidecomputer/omicron) TUF repository artifacts from [Buildomat](https://buildomat.eng.oxide.computer).

<img width="75%" height="75%" alt="image" src="https://github.com/user-attachments/assets/101fe9ae-3d92-41c1-84d7-67a58def6771" />

## Features

- Browse recent commits on `oxidecomputer/omicron` with GitHub API integration
- See which commits have TUF repo artifacts available
- Optional server-side storage: save artifacts to a NAS or local disk with progress tracking
- Serve previously downloaded artifacts directly from disk

## Quick Start

A pre-built image is available on GitHub Container Registry:

```bash
docker run -d --name omicron-tuf \
  -p 3000:3000 \
  -e GITHUB_TOKEN=ghp_yourtoken \
  ghcr.io/sion42x/omicron-tuf-browser:latest
```

Open `http://localhost:3000`.

### With server-side storage

Mount any directory or dataset for persistent artifact storage:

```bash
docker run -d --name omicron-tuf \
  -p 3000:3000 \
  -e GITHUB_TOKEN=ghp_yourtoken \
  -e DOWNLOAD_DIR=/downloads \
  -v /path/to/storage:/downloads \
  ghcr.io/sion42x/omicron-tuf-browser:latest
```

When `DOWNLOAD_DIR` is configured, each commit's artifacts are saved to a subdirectory named by commit SHA:

```
/path/to/storage/
  79fac7deb9ac/
    tuf-mupdate.zip
    manifest.toml
    tuf-mupdate.zip.sha256.txt
```

Files saved to storage are served directly from disk on subsequent downloads.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GITHUB_TOKEN` | Yes | GitHub personal access token (needs `public_repo` scope) for browsing commits |
| `DOWNLOAD_DIR` | No | Path for server-side artifact storage. Enables "Save to NAS" functionality |
| `PORT` | No | Server port (default: `3000`) |

## Running Without Docker

```bash
npm install
GITHUB_TOKEN=ghp_yourtoken node server.js
```

## Deploying on TrueNAS Scale

This app slots in naturally as a TrueNAS or other system custom app with a dataset-backed download directory.

1. In **Apps → Discover Apps → Custom App**, configure:
   - **Image:** `ghcr.io/sion42x/omicron-tuf-browser:latest`
   - **Port:** host `30080` : container `30080`
   - **Environment variables:**
     - `GITHUB_TOKEN`: your GitHub token
     - `DOWNLOAD_DIR`: `/downloads`
     - `PORT`: `30080`
   - **Storage:** add a host path mount mapping a dataset (e.g. `/mnt/pool/tuf-downloads`) to `/downloads`

2. Ensure the storage dataset is writable by the container user (UID 568 on TrueNAS):
   ```bash
   sudo chown 568:568 /mnt/pool/tuf-downloads
   ```

3. Optionally put it behind a reverse proxy (Caddy, nginx, Tailscale Serve, etc.) for HTTPS with a custom domain.

## Deploying Anywhere Else

The app runs anywhere Docker runs. Point `DOWNLOAD_DIR` at any persistent storage — a local directory, an NFS mount, an iSCSI volume, whatever you have. The only external dependencies are network access to `buildomat.eng.oxide.computer` and `api.github.com`.

## Building the Image

```bash
docker build -t omicron-tuf-browser .
```

### Cross-platform (e.g. building for amd64 from Apple Silicon)

```bash
docker buildx build --platform linux/amd64 -t ghcr.io/youruser/omicron-tuf-browser:latest --push .
```

## License

MIT
