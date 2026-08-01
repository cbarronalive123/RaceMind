# ==============================================================================
# RaceMind - Deploy to Production Server
# Run from project root: pwsh server_setup/deploy_racemind.ps1
#
# Deploys:
#   - Next.js standalone build (port 3003)
#   - Race server WebSocket (port 3004)
#   - PostgreSQL database (uses existing server postgres on port 5432)
#   - Nginx reverse proxy on port 8083
#
# Access URL: http://45.137.194.227:8083
# ==============================================================================

$ErrorActionPreference = "Stop"
$SERVER = "root@45.137.194.227"
$SSH_KEY = "$env:USERPROFILE\.ssh\id_ed25519_rshack"
$PROJECT_ROOT = Split-Path -Parent $PSScriptRoot
$WEB_DIR = Join-Path $PROJECT_ROOT "website"
$DATA_DIR = Join-Path $PROJECT_ROOT "data"
$SETUP_DIR = $PSScriptRoot

# Server-side paths
$REMOTE_DIR = "/opt/racemind"
$REMOTE_DATA = "/opt/racemind/data"
$DB_NAME = "racemind"
$DB_USER = "racemind"
$DB_PASS = "RaceMind2026Secure!"
$WEB_PORT = 3003
$RACE_PORT = 3004
$NGINX_PORT = 8083

Write-Host ""
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host " RaceMind - Deploy to Production" -ForegroundColor Cyan
Write-Host "=============================================" -ForegroundColor Cyan
Write-Host ""

# Step 1: Build Next.js
Write-Host "[1/6] Building Next.js app..." -ForegroundColor Yellow
Set-Location $WEB_DIR
npm run build
if ($LASTEXITCODE -ne 0) {
    Write-Host "BUILD FAILED" -ForegroundColor Red
    exit 1
}
Write-Host "Build complete." -ForegroundColor Green

# Step 2: Bundle race server
Write-Host ""
Write-Host "[2/6] Bundling race server..." -ForegroundColor Yellow
npx esbuild server/index.ts --bundle --platform=node --outfile=.next/standalone/race-server.js --format=cjs
if ($LASTEXITCODE -ne 0) {
    Write-Host "RACE SERVER BUNDLE FAILED" -ForegroundColor Red
    exit 1
}
Write-Host "Race server bundled." -ForegroundColor Green

# Step 3: Package
Write-Host ""
Write-Host "[3/6] Packaging build..." -ForegroundColor Yellow
$STANDALONE_DIR = Join-Path $WEB_DIR ".next\standalone"
$TAR_PATH = Join-Path $SETUP_DIR "racemind_build.tar.gz"
$STATIC_TAR = Join-Path $SETUP_DIR "racemind_static.tar.gz"
$DATA_TAR = Join-Path $SETUP_DIR "racemind_data.tar.gz"

# Package standalone (includes server.js + race-server.js + node_modules)
tar -czf $TAR_PATH -C $STANDALONE_DIR "."
if ($LASTEXITCODE -ne 0) {
    Write-Host "PACKAGING FAILED" -ForegroundColor Red
    exit 1
}

# Package static assets
tar -czf $STATIC_TAR -C $WEB_DIR ".next\static" "public"

# Package data directory
tar -czf $DATA_TAR -C $DATA_DIR "."

$SizeMB = [math]::Round((Get-Item $TAR_PATH).Length / 1MB, 1)
Write-Host "Packaged standalone: $SizeMB MB" -ForegroundColor Green

# Step 4: Upload
Write-Host ""
Write-Host "[4/6] Uploading to server..." -ForegroundColor Yellow
scp -o StrictHostKeyChecking=no -i $SSH_KEY $TAR_PATH "${SERVER}:/root/racemind_build.tar.gz"
if ($LASTEXITCODE -ne 0) {
    Write-Host "UPLOAD FAILED" -ForegroundColor Red
    exit 1
}
scp -o StrictHostKeyChecking=no -i $SSH_KEY $STATIC_TAR "${SERVER}:/root/racemind_static.tar.gz"
scp -o StrictHostKeyChecking=no -i $SSH_KEY $DATA_TAR "${SERVER}:/root/racemind_data.tar.gz"
Write-Host "Upload complete." -ForegroundColor Green

# Step 5: Setup database + deploy on server
Write-Host ""
Write-Host "[5/6] Setting up database and deploying..." -ForegroundColor Yellow

$SETUP_CMD = @"
# Create user if not exists
sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASS' CREATEDB;"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"

# Create system user if not exists
id $DB_USER 2>/dev/null || useradd -r -m -d $REMOTE_DIR -s /bin/bash $DB_USER

# Create directories
mkdir -p $REMOTE_DIR $REMOTE_DATA

# Extract standalone build
cd $REMOTE_DIR
tar -xzf /root/racemind_build.tar.gz

# Extract static assets
tar -xzf /root/racemind_static.tar.gz

# Extract data
cd $REMOTE_DATA
tar -xzf /root/racemind_data.tar.gz

# Load database schema
sudo -u postgres psql -d $DB_NAME -f $REMOTE_DATA/../server/schema.sql 2>/dev/null || true

# Copy schema to standalone dir (race server references it)
cp $REMOTE_DATA/../server/schema.sql $REMOTE_DIR/server/schema.sql 2>/dev/null || true

# Write .env file
cat > $REMOTE_DIR/.env <<'ENVEOF'
NODE_ENV=production
PORT=$WEB_PORT
RACE_WS_PORT=$RACE_PORT
PGHOST=localhost
PGPORT=5432
PGDATABASE=$DB_NAME
PGUSER=$DB_USER
PGPASSWORD=$DB_PASS
NEXT_PUBLIC_GOOGLE_MAPS_KEY=AIzaSyB3lU0ivm_7VoD6Euu9ktFxatLbcDAWZoI
ENVEOF

# Set ownership
chown -R $DB_USER:$DB_USER $REMOTE_DIR

# Write race server systemd service
cat > /etc/systemd/system/racemind-race.service <<'SVCEOF'
[Unit]
Description=RaceMind Race Server (WebSocket)
After=network.target postgresql.service

[Service]
Type=simple
User=$DB_USER
Group=$DB_USER
WorkingDirectory=$REMOTE_DIR
ExecStart=/usr/bin/node race-server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=RACE_WS_PORT=$RACE_PORT
Environment=PGHOST=localhost
Environment=PGPORT=5432
Environment=PGDATABASE=$DB_NAME
Environment=PGUSER=$DB_USER
Environment=PGPASSWORD=$DB_PASS
EnvironmentFile=$REMOTE_DIR/.env

[Install]
WantedBy=multi-user.target
SVCEOF

# Write web server systemd service
cat > /etc/systemd/system/racemind-web.service <<'SVCEOF2'
[Unit]
Description=RaceMind Web Server (Next.js)
After=network.target postgresql.service racemind-race.service

[Service]
Type=simple
User=$DB_USER
Group=$DB_USER
WorkingDirectory=$REMOTE_DIR
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=$WEB_PORT
Environment=RACE_WS_PORT=$RACE_PORT
Environment=PGHOST=localhost
Environment=PGPORT=5432
Environment=PGDATABASE=$DB_NAME
Environment=PGUSER=$DB_USER
Environment=PGPASSWORD=$DB_PASS
EnvironmentFile=$REMOTE_DIR/.env

[Install]
WantedBy=multi-user.target
SVCEOF2

# Write nginx config
cat > /etc/nginx/sites-available/racemind <<'NGXEOF'
server {
    listen $NGINX_PORT;
    server_name 45.137.194.227 _;

    # Next.js app
    location / {
        proxy_pass http://127.0.0.1:$WEB_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    # WebSocket race server
    location /ws/ {
        proxy_pass http://127.0.0.1:$RACE_PORT;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
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
rm /root/racemind_build.tar.gz /root/racemind_static.tar.gz /root/racemind_data.tar.gz

echo DEPLOY_OK
"@

$SSH_ARGS = "-o StrictHostKeyChecking=no"
if (Test-Path $SSH_KEY) {
    $SSH_ARGS += " -i $SSH_KEY"
}

ssh $SSH_ARGS $SERVER $SETUP_CMD

if ($LASTEXITCODE -ne 0) {
    Write-Host "REMOTE SETUP FAILED" -ForegroundColor Red
    Write-Host "Check logs: ssh root@45.137.194.227 'journalctl -u racemind-web -f --no-pager | tail -20'" -ForegroundColor Yellow
    exit 1
}

# Step 6: Verify
Write-Host ""
Write-Host "[6/6] Verifying deployment..." -ForegroundColor Yellow
Start-Sleep -Seconds 3

$VERIFY_CMD = "curl -s -o /dev/null -w '%{http_code}' http://localhost:$NGINX_PORT/"
$RESULT = ssh $SSH_ARGS $SERVER $VERIFY_CMD

if ($RESULT -eq "200") {
    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Green
    Write-Host " DEPLOYED SUCCESSFULLY" -ForegroundColor Green
    Write-Host " http://45.137.194.227:$NGINX_PORT" -ForegroundColor Green
    Write-Host "=============================================" -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "=============================================" -ForegroundColor Yellow
    Write-Host " DEPLOYED (HTTP $RESULT)" -ForegroundColor Yellow
    Write-Host " http://45.137.194.227:$NGINX_PORT" -ForegroundColor Yellow
    Write-Host "=============================================" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Services: racemind-web (port $WEB_PORT), racemind-race (port $RACE_PORT)" -ForegroundColor Cyan
Write-Host "Database: $DB_NAME on PostgreSQL (port 5432)" -ForegroundColor Cyan
Write-Host "Nginx: port $NGINX_PORT" -ForegroundColor Cyan
Write-Host ""
