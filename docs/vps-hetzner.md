# Taskdex Bridge VPS Setup (Hetzner)

This guide deploys the bridge to a Hetzner Ubuntu server with Docker, Caddy (WSS), and systemd.

## 1. Create the server and install Docker

1. Create a Hetzner Cloud server (Ubuntu 24.04, at least 2 vCPU / 4 GB RAM).
2. Add your local SSH public key in Hetzner before provisioning.
3. SSH in:

```bash
ssh root@<server-ip>
```

4. Install Docker + compose plugin:

```bash
apt update
apt install -y ca-certificates curl gnupg
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
chmod a+r /etc/apt/keyrings/docker.gpg

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" > /etc/apt/sources.list.d/docker.list

apt update
apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin git
systemctl enable --now docker
```

## 2. Configure SSH/deploy keys for private repos

Use a dedicated deploy key on the server:

```bash
mkdir -p /root/.ssh && chmod 700 /root/.ssh
ssh-keygen -t ed25519 -C "taskdex-bridge" -f /root/.ssh/taskdex_bridge -N ""
cat /root/.ssh/taskdex_bridge.pub
```

1. Add the printed public key as a read-only deploy key on each GitHub repo.
2. Configure SSH for GitHub:

```bash
cat >> /root/.ssh/config <<'CFG'
Host github.com
  HostName github.com
  User git
  IdentityFile /root/.ssh/taskdex_bridge
  IdentitiesOnly yes
CFG
chmod 600 /root/.ssh/config
ssh -T git@github.com
```

## 3. Clone app and configure env

```bash
mkdir -p /opt/taskdex
cd /opt/taskdex
git clone git@github.com:dhruvalgolakiya/taskdex.git
cd taskdex
```

Create `.env`:

```bash
cat > .env <<'ENV'
PORT=3001
API_KEY=<set-strong-random-key>
OPENAI_API_KEY=<your-openai-key>
HOST_CODE_DIR=/opt/repos
CODEX_CWD=/workspace
REPOS_DIR=/root/.taskdex/repos
AUTO_PULL_REPOS=true
ENV
```

Create host repo directory:

```bash
mkdir -p /opt/repos
```

## 4. Start bridge with Docker

```bash
cd /opt/taskdex/taskdex
docker compose up -d --build
docker compose ps
docker compose logs -f bridge
```

## 5. Reverse proxy with Caddy (WSS over HTTPS)

Install Caddy:

```bash
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt update
apt install -y caddy
```

Set DNS `bridge.yourdomain.com` to the server IP and configure `/etc/caddy/Caddyfile`:

```caddy
bridge.yourdomain.com {
  reverse_proxy 127.0.0.1:3001
}
```

Reload Caddy:

```bash
systemctl enable --now caddy
systemctl reload caddy
```

Mobile bridge URL becomes:

```text
wss://bridge.yourdomain.com
```

## 6. Keep bridge running (systemd)

Docker already uses systemd. To guarantee restart on reboot:

```bash
systemctl enable docker
```

And verify compose policy in `docker-compose.yml` remains `restart: unless-stopped`.

If you do not want Docker, use PM2 instead:

```bash
npm install -g pm2
cd /opt/taskdex/taskdex/bridge-server
npm ci
npm run build
pm2 start "npm start" --name taskdex-bridge
pm2 save
pm2 startup
```

## 7. Verify

```bash
curl "http://127.0.0.1:3001/health?key=<API_KEY>"
curl "https://bridge.yourdomain.com/health?key=<API_KEY>"
```

Expected: JSON with `ok: true`, uptime, agent count, and connected clients.

## Notes on auto-pull before agent start

- `AUTO_PULL_REPOS=true` enables a bridge-side `git pull` before `create_agent`.
- Auto-pull runs only when `cwd` is inside `REPOS_DIR` and has a `.git` directory.
- Pull errors are logged but do not block agent creation.
