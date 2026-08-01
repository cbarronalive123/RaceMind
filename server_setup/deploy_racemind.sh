#!/bin/bash
set -e

# ==============================================================================
# RaceMind - Deploy to Production Server (Bash version)
# Run from project root: bash server_setup/deploy_racemind.sh
# Access URL: http://45.137.194.227:8083
# ==============================================================================

SERVER="root@45.137.194.227"
SSH_KEY="$HOME/.ssh/id_ed25519_rshack"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
WEB_DIR="$PROJECT_ROOT/website"
DATA_DIR="$PROJECT_ROOT/data"
SETUP_DIR="$SCRIPT_DIR"

REMOTE_DIR="/opt/racemind"
REMOTE_DATA="/opt/racemind/data"
DB_NAME="racemind"
DB_USER="racemind"
DB_PASS="RaceMind2026Secure!"
WEB_PORT=3003
RACE_PORT=3004
NGINX_PORT=8083

SSH_ARGS="-o StrictHostKeyChecking=no -i $SSH_KEY"

echo ""
echo "============================================="
echo " RaceMind - Deploy to Production"
echo "============================================="
echo ""

# Step 1: Build Next.js
echo "[1/6] Building Next.js app..."
cd "$WEB_DIR"
npm run build
echo "Build complete."

# Step 2: Bundle race server
echo ""
echo "[2/6] Bundling race server..."
npx esbuild server/index.ts --bundle --platform=node --outfile=.next/standalone/race-server.js --format=cjs
echo "Race server bundled."

# Copy schema.sql to standalone
mkdir -p .next/standalone/server
cp server/schema.sql .next/standalone/server/schema.sql

# Step 3: Package
echo ""
echo "[3/6] Packaging build..."
TAR_PATH="$SETUP_DIR/racemind_build.tar.gz"
STATIC_TAR="$SETUP_DIR/racemind_static.tar.gz"
DATA_TAR="$SETUP_DIR/racemind_data.tar.gz"

tar -czf "$TAR_PATH" -C .next/standalone "."
tar -czf "$STATIC_TAR" -C . ".next/static" "public" 2>/dev/null || tar -czf "$STATIC_TAR" -C . ".next/static"
tar -czf "$DATA_TAR" -C "$DATA_DIR" "."

SIZE_MB=$(du -m "$TAR_PATH" | cut -f1)
echo "Packaged standalone: ${SIZE_MB} MB"

# Step 4: Upload
echo ""
echo "[4/6] Uploading to server..."
scp $SSH_ARGS "$TAR_PATH" "${SERVER}:/root/racemind_build.tar.gz"
scp $SSH_ARGS "$STATIC_TAR" "${SERVER}:/root/racemind_static.tar.gz"
scp $SSH_ARGS "$DATA_TAR" "${SERVER}:/root/racemind_data.tar.gz"
echo "Upload complete."

# Step 5: Setup database + deploy on server
echo ""
echo "[5/6] Setting up database and deploying..."

ssh $SSH_ARGS $SERVER bash -s << REMOTE_SCRIPT
set -e

DB_NAME="$DB_NAME"
DB_USER="$DB_USER"
DB_PASS="$DB_PASS"
REMOTE_DIR="$REMOTE_DIR"
REMOTE_DATA="$REMOTE_DATA"
WEB_PORT=$WEB_PORT
RACE_PORT=$RACE_PORT
NGINX_PORT=$NGINX_PORT

# Create database user if not exists
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='\$DB_USER'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE USER \$DB_USER WITH PASSWORD '\$DB_PASS' CREATEDB;"

# Create database if not exists
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='\$DB_NAME'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE DATABASE \$DB_NAME OWNER \$DB_USER;"

sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE \$DB_NAME TO \$DB_USER;"

# Create system user if not exists
id \$DB_USER 2>/dev/null || useradd -r -m -d \$REMOTE_DIR -s /bin/bash \$DB_USER

# Create directories
mkdir -p \$REMOTE_DIR \$REMOTE_DATA

# Extract standalone build
cd \$REMOTE_DIR
tar -xzf /root/racemind_build.tar.gz

# Extract static assets
tar -xzf /root/racemind_static.tar.gz

# Extract data
cd \$REMOTE_DATA
tar -xzf /root/racemind_data.tar.gz

# Load database schema (ignore errors if tables already exist)
sudo -u postgres psql -d \$DB_NAME -f \$REMOTE_DIR/server/schema.sql 2>/dev/null || true

# Write .env file
cat > \$REMOTE_DIR/.env << ENVEOF
NODE_ENV=production
PORT=\$WEB_PORT
RACE_WS_PORT=\$RACE_PORT
PGHOST=localhost
PGPORT=5432
PGDATABASE=\$DB_NAME
PGUSER=\$DB_USER
PGPASSWORD=\$DB_PASS
NEXT_PUBLIC_GOOGLE_MAPS_KEY=AIzaSyB3lU0ivm_7VoD6Euu9ktFxatLbcDAWZoI
ENVEOF

# Set ownership
chown -R \$DB_USER:\$DB_USER \$REMOTE_DIR

# Write race server systemd service
cat > /etc/systemd/system/racemind-race.service << SVCEOF
[Unit]
Description=RaceMind Race Server (WebSocket)
After=network.target postgresql.service

[Service]
Type=simple
User=\$DB_USER
Group=\$DB_USER
WorkingDirectory=\$REMOTE_DIR
ExecStart=/usr/bin/node race-server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=RACE_WS_PORT=\$RACE_PORT
Environment=PGHOST=localhost
Environment=PGPORT=5432
Environment=PGDATABASE=\$DB_NAME
Environment=PGUSER=\$DB_USER
Environment=PGPASSWORD=\$DB_PASS
EnvironmentFile=\$REMOTE_DIR/.env

[Install]
WantedBy=multi-user.target
SVCEOF

# Write web server systemd service
cat > /etc/systemd/system/racemind-web.service << SVCEOF2
[Unit]
Description=RaceMind Web Server (Next.js)
After=network.target postgresql.service racemind-race.service

[Service]
Type=simple
User=\$DB_USER
Group=\$DB_USER
WorkingDirectory=\$REMOTE_DIR
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=\$WEB_PORT
Environment=RACE_WS_PORT=\$RACE_PORT
Environment=PGHOST=localhost
Environment=PGPORT=5432
Environment=PGDATABASE=\$DB_NAME
Environment=PGUSER=\$DB_USER
Environment=PGPASSWORD=\$DB_PASS
EnvironmentFile=\$REMOTE_DIR/.env

[Install]
WantedBy=multi-user.target
SVCEOF2

# Write nginx config
cat > /etc/nginx/sites-available/racemind << NGXEOF
server {
    listen \$NGINX_PORT;
    server_name 45.137.194.227 _;

    location / {
        proxy_pass http://127.0.0.1:\$WEB_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \\\$scheme;
        proxy_cache_bypass \\\$http_upgrade;
    }

    location /ws/ {
        proxy_pass http://127.0.0.1:\$RACE_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \\\$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \\\$host;
        proxy_set_header X-Real-IP \\\$remote_addr;
        proxy_set_header X-Forwarded-For \\\$proxy_add_x_forwarded_for;
    }
}
NGXEOF

# Enable nginx site
ln -sf /etc/nginx/sites-available/racemind /etc/nginx/sites-enabled/racemind

# Test nginx config
nginx -t

# Reload services
systemctl daemon-reload
systemctl enable racemind-race racemind-web
systemctl restart racemind-race
sleep 2
systemctl restart racemind-web
sleep 2
systemctl reload nginx

# Verify
systemctl is-active racemind-race
systemctl is-active racemind-web

# Cleanup
rm -f /root/racemind_build.tar.gz /root/racemind_static.tar.gz /root/racemind_data.tar.gz

echo DEPLOY_OK
REMOTE_SCRIPT

if [ $? -ne 0 ]; then
    echo "REMOTE SETUP FAILED"
    echo "Check logs: ssh -i $SSH_KEY root@45.137.194.227 'journalctl -u racemind-web -f --no-pager | tail -20'"
    exit 1
fi

# Step 6: Verify
echo ""
echo "[6/6] Verifying deployment..."
sleep 3

RESULT=$(ssh $SSH_ARGS $SERVER "curl -s -o /dev/null -w '%{http_code}' http://localhost:$NGINX_PORT/")
echo ""
echo "============================================="
if [ "$RESULT" = "200" ]; then
    echo " DEPLOYED SUCCESSFULLY"
else
    echo " DEPLOYED (HTTP $RESULT)"
fi
echo " http://45.137.194.227:$NGINX_PORT"
echo "============================================="
echo ""
echo "Services: racemind-web (port $WEB_PORT), racemind-race (port $RACE_PORT)"
echo "Database: $DB_NAME on PostgreSQL (port 5432)"
echo "Nginx: port $NGINX_PORT"
echo ""
