# DEVGUIDE — Tennis 1v1

## Контекст

Руководство по локальной разработке, деплою на сервер и работе с инструментами управления. Каждый шаг фиксируется по мере реализации.

---

## Структура проекта

```
tennis1v1/
├── client/                  # Phaser 3 + TypeScript + Vite
│   ├── public/
│   │   └── assets/
│   │       ├── players/
│   │       ├── courts/
│   │       ├── rackets/
│   │       ├── ball/
│   │       ├── ui/
│   │       └── sounds/
│   ├── src/
│   │   ├── assets.config.ts # Реестр всех ассетов
│   │   ├── scenes/          # Phaser сцены
│   │   ├── network/         # Socket.io клиент
│   │   ├── ui/              # UI компоненты
│   │   └── types/           # Общие типы
│   ├── index.html
│   ├── vite.config.ts
│   └── package.json
│
├── server/                  # Node.js + TypeScript
│   ├── src/
│   │   ├── index.ts         # Точка входа
│   │   ├── api/             # Express роуты
│   │   ├── socket/          # Socket.io обработчики
│   │   ├── game/            # Игровой цикл, физика
│   │   ├── rooms/           # Управление комнатами
│   │   ├── auth/            # JWT, Firebase верификация
│   │   └── types/           # Общие типы (shared с клиентом)
│   ├── prisma/
│   │   └── schema.prisma
│   └── package.json
│
├── nginx/
│   ├── nginx.conf
│   └── ssl/
│
├── docker-compose.yml
├── docker-compose.prod.yml
└── docs/
```

---

## Локальная разработка

Весь код и все команды выполняются **внутри Linux-окружения** — WSL2 на Windows или Terminal на macOS. На хостовой Windows ничего не устанавливается.

---

### Подготовка машины (один раз)

#### Windows — настройка WSL2

```bash
# 1. Открыть PowerShell от имени администратора и установить WSL2
wsl --install
# Перезагрузить машину. По умолчанию установится Ubuntu.

# 2. Запустить Ubuntu из меню Пуск, создать пользователя.

# 3. Установить Docker Desktop для Windows:
#    https://www.docker.com/products/docker-desktop/
#    В настройках Docker Desktop: Settings → Resources → WSL Integration
#    → включить интеграцию с Ubuntu

# Всё дальнейшее выполняется внутри терминала Ubuntu (WSL2)
```

#### Windows — настройка Cursor для работы с WSL2

Cursor должен открывать проект **изнутри WSL**, а не из Windows. Иначе терминал, Git и Node.js будут работать некорректно.

1. Установить Cursor: https://www.cursor.com/
2. Открыть Cursor → Extensions (`Ctrl+Shift+X`) → найти **WSL** (Microsoft) → Install
3. Открыть терминал Ubuntu (WSL2) и перейти в папку проекта:
```bash
cd ~/projects/tennis1v1
cursor .
```
4. Cursor откроется с WSL-окружением — в левом нижнем углу будет индикатор `WSL: Ubuntu`
5. Все терминалы внутри Cursor теперь работают в Linux — команды `npm`, `docker`, `git` используют WSL

> ⚠️ Никогда не открывай проект через `File → Open Folder` из Windows-проводника — путь вида `C:\Users\...` сломает все команды.

Внутри WSL2 (Ubuntu):

```bash
# Обновить пакеты
sudo apt update && sudo apt upgrade -y

# Установить nvm (менеджер версий Node.js)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.bashrc

# Установить Node.js 20
nvm install 20
nvm use 20
nvm alias default 20

# Проверить
node -v   # v20.x.x
npm -v

# Установить Git (обычно уже есть)
sudo apt install -y git

# Настроить SSH-ключ для GitHub (если ещё не настроен)
ssh-keygen -t ed25519 -C "your@email.com"
# Нажать Enter три раза (путь и пароль по умолчанию)
cat ~/.ssh/id_ed25519.pub
# Скопировать вывод → GitHub → Settings → SSH keys → New SSH key → вставить → Add

# Проверить что SSH работает
ssh -T git@github.com
# Ожидаемый ответ: "Hi username! You've successfully authenticated..."
```

#### macOS — настройка Cursor

1. Установить Cursor: https://www.cursor.com/
2. Установить команду `cursor` в PATH: Cursor → `Cmd+Shift+P` → `Shell Command: Install 'cursor' command in PATH`
3. Открывать проект из терминала: `cd ~/projects/tennis1v1 && cursor .`

#### macOS — настройка среды

```bash
# 1. Установить Homebrew (если не установлен)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# 2. Установить nvm
brew install nvm
# Добавить в ~/.zshrc:
echo 'export NVM_DIR="$HOME/.nvm"' >> ~/.zshrc
echo '[ -s "$(brew --prefix)/opt/nvm/nvm.sh" ] && . "$(brew --prefix)/opt/nvm/nvm.sh"' >> ~/.zshrc
source ~/.zshrc

# 3. Установить Node.js 20
nvm install 20
nvm use 20
nvm alias default 20

# 4. Установить Docker Desktop для Mac:
#    https://www.docker.com/products/docker-desktop/
#    Запустить Docker Desktop, дождаться статуса Running.

# Проверить
node -v   # v20.x.x
docker -v
```

---

### Первый запуск проекта (одинаково на обеих машинах)

```bash
# Клонировать репозиторий
git clone git@github.com:artyomiroshnichenko/tennis1v1.git
cd tennis1v1

# Скопировать шаблоны переменных окружения
cp server/.env.example server/.env
cp client/.env.example client/.env
# Заполнить значения в server/.env и client/.env (см. раздел «Переменные окружения»)

# Запустить PostgreSQL в Docker
docker compose -f docker-compose.dev.yml up -d
# Проверить что контейнер запустился:
docker compose -f docker-compose.dev.yml ps

# Установить зависимости и применить миграции БД
cd server
npm install
npx prisma migrate dev

# Запустить сервер (остаётся в фоне этого терминала)
npm run dev

# В новой вкладке терминала — запустить клиент
cd ../client
npm install
npm run dev
```

После этого открыть в браузере:

| Сервис | URL | Описание |
|---|---|---|
| Клиент (игра) | http://localhost:5173 | Phaser + Vite dev server |
| Сервер (API) | http://localhost:3000 | Express + Socket.io |
| PostgreSQL | localhost:5432 | Только для подключений (не браузер) |
| Prisma Studio | http://localhost:5555 | Запускается отдельно: `npx prisma studio` |

---

### Последующие запуски

```bash
# Терминал 1 — сервер
cd tennis1v1/server && npm run dev

# Терминал 2 — клиент
cd tennis1v1/client && npm run dev

# Docker запускается автоматически при старте Docker Desktop.
# Если контейнер остановлен:
docker compose -f docker-compose.dev.yml up -d
```

---

### Переключение между машинами

```bash
# На новой машине после первого запуска — просто получить последние изменения
git pull

# Если добавились новые зависимости
npm install          # в server/ и client/

# Если добавились новые миграции БД
cd server && npx prisma migrate dev
```

### Переменные окружения

Создать `server/.env`:
```
DATABASE_URL=postgresql://postgres:password@localhost:5432/tennis1v1
JWT_SECRET=...
FIREBASE_PROJECT_ID=...
FIREBASE_PRIVATE_KEY=...
FIREBASE_CLIENT_EMAIL=...
```

### Настройка Firebase Auth (один раз)

1. Открыть [Firebase Console](https://console.firebase.google.com/) → создать проект
2. Раздел **Authentication** → Sign-in method → включить **Email/Password** и **Phone**
3. Раздел **Project settings** → вкладка **Service accounts** → Generate new private key → скачать JSON
4. Из скачанного JSON взять значения и вставить в `server/.env`:
   - `FIREBASE_PROJECT_ID` — поле `project_id`
   - `FIREBASE_PRIVATE_KEY` — поле `private_key` (вставлять со всеми `\n`, в кавычках)
   - `FIREBASE_CLIENT_EMAIL` — поле `client_email`
5. Для фронтенда создать `client/.env`:
```
VITE_FIREBASE_API_KEY=...
VITE_FIREBASE_AUTH_DOMAIN=...
VITE_FIREBASE_PROJECT_ID=...
```
   Значения взять из **Project settings** → вкладка **General** → раздел Your apps → Web app config

> Файлы `.env` не коммитятся. Шаблоны хранятся в `.env.example` без реальных значений.

---

## Деплой на сервер

### Первичная настройка сервера

```bash
# Установить Docker
curl -fsSL https://get.docker.com | sh

# Установить docker-compose
apt install docker-compose-plugin

# Клонировать репозиторий
git clone git@github.com:...tennis1v1.git /opt/tennis1v1
cd /opt/tennis1v1
```

### SSL сертификат (Let's Encrypt)

```bash
# Установить Certbot
apt install certbot python3-certbot-nginx

# Получить сертификат
certbot --nginx -d домен.ru -d www.домен.ru

# Автообновление — добавляется автоматически в cron
```

### Запуск в продакшене

```bash
cd /opt/tennis1v1

# Создать .env файл с продакшен переменными
cp server/.env.example server/.env
# Заполнить переменные

# Запустить все сервисы
docker-compose -f docker-compose.prod.yml up -d

# Применить миграции БД
docker-compose exec server npx prisma migrate deploy
```

### Обновление

```bash
cd /opt/tennis1v1
git pull
docker-compose -f docker-compose.prod.yml up -d --build
docker-compose exec server npx prisma migrate deploy
```

---

## Инструменты управления

### pgAdmin (PostgreSQL)

- URL: `https://pgadmin.домен.ru`
- Логин/пароль: задаётся в docker-compose.prod.yml
- Возможности: просмотр таблиц, SQL запросы, управление данными, резервные копии

### Portainer (Docker)

- URL: `https://portainer.домен.ru`
- Возможности: просмотр контейнеров, логи, перезапуск сервисов, статус

### Netdata (Мониторинг сервера)

- URL: `https://netdata.домен.ru`
- Возможности: CPU, RAM, сеть, диск в реальном времени

### Просмотр логов через Portainer

1. Открыть Portainer → Containers
2. Нажать на контейнер (например `server`)
3. Вкладка Logs — логи в реальном времени

### Просмотр логов через командную строку

```bash
# Логи конкретного сервиса
docker-compose logs -f server

# Логи всех сервисов
docker-compose logs -f
```

---

## Работа с базой данных

### Назначение роли администратора

После первичного деплоя и регистрации нужного аккаунта выполнить в Prisma Studio или через SQL:

```sql
UPDATE "User" SET role = 'ADMIN' WHERE nickname = 'ваш_никнейм';
```

Или через Prisma Studio: открыть таблицу `User`, найти нужного пользователя, изменить поле `role` на `ADMIN`.

### Prisma Studio (локально)

```bash
cd server
npx prisma studio
# Открывается веб-интерфейс на localhost:5555
```

### Базовая схема (schema.prisma)

```prisma
model User {
  id        String   @id @default(uuid())
  firebaseId String? @unique      // null для гостей
  nickname  String   @unique
  role      Role     @default(USER)
  createdAt DateTime @default(now())

  matches   MatchPlayer[]
}

enum Role {
  USER
  ADMIN
}

model Match {
  id          String      @id @default(uuid())
  type        MatchType
  status      MatchStatus
  winnerId    String?
  sets        Json                         // [[6,3],[4,6],[7,5]]
  duration    Int?                         // секунды
  createdAt   DateTime    @default(now())
  finishedAt  DateTime?

  players     MatchPlayer[]
}

enum MatchType {
  ONLINE    // игрок vs игрок
  BOT       // игрок vs бот
}

enum MatchStatus {
  FINISHED
  TECHNICAL_DEFEAT  // техническое поражение по отключению
}

model MatchPlayer {
  id       String  @id @default(uuid())
  matchId  String
  userId   String
  side     String  // 'left' | 'right'
  isWinner Boolean

  match    Match   @relation(fields: [matchId], references: [id])
  user     User    @relation(fields: [userId], references: [id])
}
```

### Миграции

```bash
# Создать новую миграцию после изменения schema.prisma
npx prisma migrate dev --name название_миграции

# Применить миграции на сервере
npx prisma migrate deploy

# Сбросить БД (только dev!)
npx prisma migrate reset
```

---

## Чеклист

- [ ] На Windows: WSL2 + Ubuntu установлены, Docker Desktop интегрирован с WSL2
- [ ] На macOS: Docker Desktop установлен и запущен
- [ ] Node.js 20 установлен через nvm на обеих машинах
- [ ] SSH-ключ добавлен в GitHub для клонирования по SSH
- [ ] Локальная разработка поднимается командами из раздела «Первый запуск»
- [ ] docker-compose.dev.yml настроен для локальной разработки
- [ ] docker-compose.prod.yml настроен для продакшена
- [ ] Nginx конфиг настроен: SSL, статика, /api/, /socket.io/
- [ ] Let's Encrypt сертификат получен и автообновляется
- [ ] pgAdmin доступен по защищённому URL
- [ ] Portainer доступен по защищённому URL
- [ ] Netdata доступен по защищённому URL
- [ ] Prisma схема определена, первая миграция применена
- [ ] .env.example создан с документацией всех переменных (server и client)
- [ ] Firebase Auth настроен: Email/Password и Phone включены в консоли
- [ ] Service account JSON получен и значения перенесены в server/.env
- [ ] Клиентские Firebase-переменные добавлены в client/.env
