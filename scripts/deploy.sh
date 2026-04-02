#!/bin/bash
set -e

APP_DIR="/opt/tennis1v1"
cd "$APP_DIR"

echo ""
echo "╔══════════════════════════════════════╗"
echo "║     Tennis 1v1 — Deploy              ║"
echo "╚══════════════════════════════════════╝"
echo ""

# ─── 1. Получить последние изменения ─────────────────────────────────────────
echo "▶ [1/4] Получаю обновления из репозитория..."
git pull
echo "✓ Готово"

# ─── 2. Собрать клиент ───────────────────────────────────────────────────────
echo ""
echo "▶ [2/4] Собираю клиент..."
cd client

# Установить Node.js если нет
if ! command -v node &>/dev/null; then
  echo "  Устанавливаю Node.js 20..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi

npm install --silent
npm run build
cd "$APP_DIR"
echo "✓ Клиент собран → client/dist/"

# ─── 3. Запустить контейнеры ─────────────────────────────────────────────────
echo ""
echo "▶ [3/4] Запускаю контейнеры..."
docker compose -f docker-compose.prod.yml up -d --build
echo "✓ Контейнеры запущены"

# ─── 4. Миграции БД ──────────────────────────────────────────────────────────
echo ""
echo "▶ [4/4] Применяю миграции БД..."
# Подождать пока PostgreSQL поднимется
sleep 5
docker compose -f docker-compose.prod.yml exec -T server npx prisma migrate deploy
echo "✓ Миграции применены"

# ─── Статус ──────────────────────────────────────────────────────────────────
echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  Деплой завершён!                                           ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
docker compose -f docker-compose.prod.yml ps
echo ""
echo "  🌐 Игра:      https://engbotai.ru"
echo "  🗄  pgAdmin:   https://pgadmin.engbotai.ru"
echo "  🐳 Portainer: https://portainer.engbotai.ru"
echo "  📊 Netdata:   https://netdata.engbotai.ru"
echo ""
