#!/usr/bin/env bash
# One-time EC2 setup script. Run once as ubuntu user after SSH-ing in.
# Usage: bash setup-ec2.sh <repo-ssh-clone-url>
# Example: bash setup-ec2.sh git@github.com:SachPlayZ/Cresc.git
set -euo pipefail

REPO_URL="${1:-}"
APP_DIR="$HOME/Cresc"

if [[ -z "$REPO_URL" ]]; then
  echo "Usage: $0 <repo-ssh-or-https-clone-url>"
  exit 1
fi

# --- Node.js 22 via nvm ---
if ! command -v node &>/dev/null; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
  # shellcheck source=/dev/null
  source "$HOME/.nvm/nvm.sh"
  nvm install 22
  nvm alias default 22
fi

echo "Node: $(node -v)"

# --- Clone repo ---
if [[ ! -d "$APP_DIR/.git" ]]; then
  git clone "$REPO_URL" "$APP_DIR"
fi

# --- Install agents deps ---
cd "$APP_DIR/agents"
npm ci --omit=dev

# --- Env file: create placeholder at /etc/cresc-agents.env ---
if [[ ! -f /etc/cresc-agents.env ]]; then
  sudo cp "$APP_DIR/agents/.env.example" /etc/cresc-agents.env
  sudo chmod 600 /etc/cresc-agents.env
  sudo chown root:root /etc/cresc-agents.env
  echo ""
  echo "IMPORTANT: Fill in secrets at /etc/cresc-agents.env before starting the service."
  echo "  sudo nano /etc/cresc-agents.env"
fi

# --- Install systemd service ---
# Patch WorkingDirectory/ExecStart to match actual APP_DIR
sed "s|/home/ubuntu/Cresc|$APP_DIR|g" \
  "$APP_DIR/agents/deploy/cresc-agents.service" \
  | sudo tee /etc/systemd/system/cresc-agents.service > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable cresc-agents

# --- Allow ubuntu to restart the service without a password ---
SUDOERS_LINE="ubuntu ALL=(ALL) NOPASSWD: /bin/systemctl restart cresc-agents, /bin/systemctl status cresc-agents"
if ! sudo grep -qF 'cresc-agents' /etc/sudoers; then
  echo "$SUDOERS_LINE" | sudo tee -a /etc/sudoers > /dev/null
  echo "Added sudoers rule for systemctl restart cresc-agents."
fi

echo ""
echo "Setup complete. Next:"
echo "  1. sudo nano /etc/cresc-agents.env   (fill in all secrets)"
echo "  2. sudo systemctl start cresc-agents"
echo "  3. journalctl -u cresc-agents -f     (watch logs)"
