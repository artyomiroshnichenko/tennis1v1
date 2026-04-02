#!/bin/bash
set -e

REPO="git@github.com:artyomiroshnichenko/tennis1v1.git"
APP_DIR="/opt/tennis1v1"
DOMAIN="engbotai.ru"
EMAIL="admin@engbotai.ru"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║     Tennis 1v1 — Server Setup        ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ─── 1. Docker ───────────────────────────────────────────────────────────────
echo "▶ [1/6] Устанавливаю Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  echo "✓ Docker установлен"
else
  echo "✓ Docker уже установлен ($(docker -v))"
fi

# ─── 2. Системные утилиты ────────────────────────────────────────────────────
echo ""
echo "▶ [2/6] Устанавливаю утилиты..."
apt-get update -qq
apt-get install -y -qq git certbot apache2-utils curl
echo "✓ Утилиты установлены"

# ─── 3. SSH-ключ для GitHub ──────────────────────────────────────────────────
echo ""
echo "▶ [3/6] Настраиваю SSH-ключ для GitHub..."
if [ ! -f /root/.ssh/id_ed25519 ]; then
  ssh-keygen -t ed25519 -C "engbotai-server" -f /root/.ssh/id_ed25519 -N ""
  echo ""
  echo "┌─────────────────────────────────────────────────────────────┐"
  echo "│  Добавь этот публичный ключ в GitHub:                       │"
  echo "│  github.com → Settings → SSH keys → New SSH key            │"
  echo "└─────────────────────────────────────────────────────────────┘"
  echo ""
  cat /root/.ssh/id_ed25519.pub
  echo ""
  read -p "Нажми Enter после того как добавил ключ в GitHub..."
else
  echo "✓ SSH-ключ уже существует"
fi

# Добавить github.com в known_hosts
ssh-keyscan -H github.com >> /root/.ssh/known_hosts 2>/dev/null

# ─── 4. Клонировать репозиторий ──────────────────────────────────────────────
echo ""
echo "▶ [4/6] Клонирую репозиторий..."
if [ ! -d "$APP_DIR" ]; then
  git clone "$REPO" "$APP_DIR"
  echo "✓ Репозиторий склонирован в $APP_DIR"
else
  cd "$APP_DIR" && git pull
  echo "✓ Репозиторий обновлён"
fi

# ─── 5. SSL сертификат ───────────────────────────────────────────────────────
echo ""
echo "▶ [5/6] Получаю SSL сертификат..."

# Убедиться что порт 80 свободен
if lsof -i :80 &>/dev/null; then
  echo "  ⚠ Порт 80 занят — освобождаю..."
  fuser -k 80/tcp 2>/dev/null || true
  sleep 2
fi

if [ ! -d "/etc/letsencrypt/live/$DOMAIN" ]; then
  certbot certonly --standalone \
    -d "$DOMAIN" \
    -d "www.$DOMAIN" \
    -d "pgadmin.$DOMAIN" \
    -d "portainer.$DOMAIN" \
    -d "netdata.$DOMAIN" \
    --email "$EMAIL" \
    --agree-tos \
    --non-interactive
  echo "✓ SSL сертификат получен"
else
  echo "✓ SSL сертификат уже существует"
fi

# Скопировать сертификаты для nginx
mkdir -p "$APP_DIR/nginx/ssl/$DOMAIN"
cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem "$APP_DIR/nginx/ssl/$DOMAIN/"
cp /etc/letsencrypt/live/$DOMAIN/privkey.pem   "$APP_DIR/nginx/ssl/$DOMAIN/"
echo "✓ Сертификаты скопированы"

# Хук автообновления
cat > /etc/letsencrypt/renewal-hooks/deploy/copy-certs.sh << EOF
#!/bin/bash
cp /etc/letsencrypt/live/$DOMAIN/fullchain.pem $APP_DIR/nginx/ssl/$DOMAIN/
cp /etc/letsencrypt/live/$DOMAIN/privkey.pem   $APP_DIR/nginx/ssl/$DOMAIN/
docker exec tennis1v1_nginx nginx -s reload
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/copy-certs.sh

# ─── 6. Переменные окружения ─────────────────────────────────────────────────
echo ""
echo "▶ [6/6] Настраиваю переменные окружения..."
cd "$APP_DIR"

if [ ! -f ".env" ]; then
  cp .env.example .env
  echo ""
  echo "┌─────────────────────────────────────────────────────────────┐"
  echo "│  Заполни пароли в файле /opt/tennis1v1/.env                 │"
  echo "│  Команда: nano /opt/tennis1v1/.env                          │"
  echo "└─────────────────────────────────────────────────────────────┘"
fi

if [ ! -f "server/.env" ]; then
  cp server/.env.example server/.env
  echo ""
  echo "┌─────────────────────────────────────────────────────────────┐"
  echo "│  Заполни Firebase и JWT в /opt/tennis1v1/server/.env        │"
  echo "│  Команда: nano /opt/tennis1v1/server/.env                   │"
  echo "└─────────────────────────────────────────────────────────────┘"
fi

if [ ! -f "client/.env" ]; then
  cp client/.env.example client/.env
fi

# .htpasswd для инструментов управления
if [ ! -f "$APP_DIR/nginx/ssl/.htpasswd" ]; then
  echo ""
  echo "┌─────────────────────────────────────────────────────────────┐"
  echo "│  Создай пароль для pgAdmin / Portainer / Netdata            │"
  echo "└─────────────────────────────────────────────────────────────┘"
  read -p "  Логин: " HTUSER
  htpasswd -bc "$APP_DIR/nginx/ssl/.htpasswd" "$HTUSER" $(read -sp "  Пароль: " HTPASS && echo "$HTPASS")
  echo ""
  echo "✓ .htpasswd создан"
fi

# ─── Готово ──────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Сервер подготовлен! Следующие шаги:                        ║"
echo "║                                                              ║"
echo "║  1. Заполни /opt/tennis1v1/.env                             ║"
echo "║  2. Заполни /opt/tennis1v1/server/.env                      ║"
echo "║  3. Заполни /opt/tennis1v1/client/.env                      ║"
echo "║  4. Запусти: cd /opt/tennis1v1 && bash scripts/deploy.sh    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
