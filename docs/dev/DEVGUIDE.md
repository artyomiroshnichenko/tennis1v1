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
npm run db:migrate:dev

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
| Готовность БД | http://localhost:3000/health/ready | Должен вернуть `200` и `database: up`; при `503` — см. раздел «Если не сохраняется никнейм» |
| PostgreSQL | localhost:5432 | Только для подключений (не браузер) |
| Prisma Studio | http://localhost:5555 | `cd server && npm run db:studio` |

---

### Если при сохранении никнейма «внутренняя ошибка» или не стартует игра

Гостевая сессия (`POST /auth/guest`) пишет refresh-токен в **PostgreSQL**. Без доступной БД сервер отвечает ошибкой (теперь с кодом **`DATABASE_UNAVAILABLE`** и пояснением в тексте).

1. **Docker:** `docker compose -f docker-compose.dev.yml ps` — контейнер `postgres` в статусе Up. Если нет: `docker compose -f docker-compose.dev.yml up -d`.
2. **`server/.env`:** есть файл (скопировать из `server/.env.example`), заполнены **`DATABASE_URL`** (как в примере для локального postgres) и **`JWT_SECRET`**.
3. **Миграции:** из каталога `server/` после `npm ci` или `npm install` выполнить **`npm run db:migrate`** (прод) или **`npm run db:migrate:dev`** (разработка). Не вызывайте **`npx prisma …`** без установленных зависимостей — npx может скачать **Prisma 7** и дать **P1012** на текущей схеме.
4. **Проверка:** в браузере открыть http://localhost:3000/health/ready — ожидается JSON с `"database": "up"`.

Если клиент открыт с одной машины, а сервер запущен в другом окружении (только Windows vs только WSL), убедитесь, что и Vite, и Node смотрят на один и тот же `localhost:3000` и что порт 5432 с хоста доступен процессу сервера.

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
cd server && npm install && npm run db:migrate:dev
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

**Важно для деплоя в Docker (`docker-compose.prod.yml`):** процесс Node крутится **внутри контейнера** `server`. Для него `localhost` — это сам контейнер, а не PostgreSQL. В **`server/.env` на сервере** укажите хост **`postgres`** (имя сервиса в compose) и те же логин/пароль/имя БД, что в корневом `.env`:

`DATABASE_URL=postgresql://POSTGRES_USER:POSTGRES_PASSWORD@postgres:5432/POSTGRES_DB`

После правки перезапустите контейнер `server` и снова выполните миграции при необходимости.

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

Домен: **engbotai.ru**

| Сервис | URL |
|---|---|
| Игра | https://engbotai.ru |
| pgAdmin | https://pgadmin.engbotai.ru |
| Portainer | https://portainer.engbotai.ru |
| Netdata | https://netdata.engbotai.ru |

Открытые задачи по прод-доступности домена (HTTPS, редиректы, Jino): **[BACKLOG.md](./BACKLOG.md)**. До их закрытия разработку и проверку игры удобно вести локально (разделы «Локальная разработка» выше).

---

### 1. Первичная настройка сервера

Подключиться по SSH к серверу (Ubuntu 22.04+):

```bash
ssh root@IP_СЕРВЕРА
```

Установить Docker:

```bash
# Установить Docker
curl -fsSL https://get.docker.com | sh

# Добавить текущего пользователя в группу docker (если не root)
usermod -aG docker $USER
newgrp docker

# Проверить
docker -v
docker compose version
```

Клонировать репозиторий:

```bash
git clone git@github.com:artyomiroshnichenko/tennis1v1.git /opt/tennis1v1
cd /opt/tennis1v1
```

---

### 2. Настроить DNS

В панели управления Jino (или у любого DNS-провайдера) добавить A-записи:

| Имя | Тип | Значение |
|---|---|---|
| `@` | A | IP_СЕРВЕРА |
| `www` | A | IP_СЕРВЕРА |
| `pgadmin` | A | IP_СЕРВЕРА |
| `portainer` | A | IP_СЕРВЕРА |
| `netdata` | A | IP_СЕРВЕРА |

Проверить что DNS распространился (может занять до 24ч):

```bash
dig engbotai.ru +short
# Должен вернуть IP_СЕРВЕРА
```

---

### 3. Получить SSL сертификат (Let's Encrypt)

```bash
# Установить Certbot
apt install -y certbot

# Временно открыть порт 80 (если закрыт)
# Убедиться что nginx ещё НЕ запущен

# Получить wildcard-сертификат через DNS-challenge
# (покрывает engbotai.ru и все поддомены *.engbotai.ru)
certbot certonly --standalone \
  -d engbotai.ru \
  -d www.engbotai.ru \
  -d pgadmin.engbotai.ru \
  -d portainer.engbotai.ru \
  -d netdata.engbotai.ru \
  --email admin@engbotai.ru \
  --agree-tos \
  --non-interactive

# Скопировать сертификаты туда, где их ожидает nginx
mkdir -p /opt/tennis1v1/nginx/ssl/engbotai.ru
cp /etc/letsencrypt/live/engbotai.ru/fullchain.pem /opt/tennis1v1/nginx/ssl/engbotai.ru/
cp /etc/letsencrypt/live/engbotai.ru/privkey.pem   /opt/tennis1v1/nginx/ssl/engbotai.ru/
```

Настроить автообновление:

```bash
# Certbot добавляет таймер systemd автоматически, проверить:
systemctl status certbot.timer

# Добавить хук для копирования после обновления
cat > /etc/letsencrypt/renewal-hooks/deploy/copy-certs.sh << 'EOF'
#!/bin/bash
cp /etc/letsencrypt/live/engbotai.ru/fullchain.pem /opt/tennis1v1/nginx/ssl/engbotai.ru/
cp /etc/letsencrypt/live/engbotai.ru/privkey.pem   /opt/tennis1v1/nginx/ssl/engbotai.ru/
docker exec tennis1v1_nginx nginx -s reload
EOF
chmod +x /etc/letsencrypt/renewal-hooks/deploy/copy-certs.sh
```

---

### 4. Создать .htpasswd для защиты инструментов

```bash
apt install -y apache2-utils

# Создать файл с логином/паролем (заменить YOUR_LOGIN и YOUR_PASSWORD)
htpasswd -bc /opt/tennis1v1/nginx/ssl/.htpasswd YOUR_LOGIN YOUR_PASSWORD
```

---

### 5. Заполнить переменные окружения

```bash
cd /opt/tennis1v1

# Корневой .env (PostgreSQL + pgAdmin)
cp .env.example .env
nano .env   # заполнить пароли

# Серверный .env (Firebase, JWT и т.д.)
cp server/.env.example server/.env
nano server/.env   # заполнить все значения

# Клиентский .env (Firebase Web SDK)
cp client/.env.example client/.env
nano client/.env
```

---

### 6. Собрать клиент и запустить

```bash
cd /opt/tennis1v1

# Собрать статику клиента
cd client && npm ci && npm run build && cd ..

# Запустить все сервисы
docker compose -f docker-compose.prod.yml up -d

# Применить миграции БД (используется Prisma из node_modules образа — см. package.json)
docker compose -f docker-compose.prod.yml exec server npm run db:migrate

# Проверить что всё запущено
docker compose -f docker-compose.prod.yml ps
```

В выводе `ps` для прода должна быть БД с именем контейнера **`tennis1v1_postgres`**. Если видите только **`tennis1v1_postgres_dev`** — это контейнер из **`docker-compose.dev.yml`**: он в **другой** Docker-сети, прод-контейнер **`server` не сможет** достучаться до хоста `postgres` (P1001). Поднимите продовский Postgres: `docker compose -f docker-compose.prod.yml up -d postgres` (или весь стек `up -d`). При желании остановите dev-стек на VPS: `docker compose -f docker-compose.dev.yml down`, чтобы не путаться.

Открыть https://engbotai.ru — игра должна быть доступна.

---

### 7. Обновление после изменений в коде

```bash
cd /opt/tennis1v1

# Получить изменения
git pull

# Пересобрать клиент если изменился frontend
cd client && npm ci && npm run build && cd ..

# Пересобрать и перезапустить контейнеры
docker compose -f docker-compose.prod.yml up -d --build

# Применить миграции если изменилась схема БД
docker compose -f docker-compose.prod.yml exec server npm run db:migrate
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
npm run db:studio
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

### Версия Prisma и CLI

Выполнять **из каталога `server/`** после `npm install`: миграции и Studio — через **`npm run db:migrate`**, **`npm run db:migrate:dev`**, **`npm run db:studio`** (в `PATH` подставится `prisma` из `node_modules`). Не вызывать **`npx prisma …`**, если в `server/node_modules` ещё нет пакета `prisma`: npx скачает **Prisma 7** → **P1012**. Подробности — **`docs/dev/BACKLOG.md`** (ENG-PRISMA7-CLI-DATASOURCE).

### Миграции

```bash
# Создать новую миграцию после изменения schema.prisma
npm run db:migrate:dev -- --name название_миграции

# Применить миграции на сервере
npm run db:migrate

# Сбросить БД (только dev!)
npm run db:reset
```

---

## Чеклист

- [ ] На Windows: WSL2 + Ubuntu установлены, Docker Desktop интегрирован с WSL2
- [ ] На macOS: Docker Desktop установлен и запущен
- [ ] Node.js 20 установлен через nvm на обеих машинах
- [ ] SSH-ключ добавлен в GitHub для клонирования по SSH
- [ ] Локальная разработка поднимается командами из раздела «Первый запуск»
- [ ] docker-compose.dev.yml настроен для локальной разработки
- [ ] docker-compose.prod.yml настроен для продакшена (server, postgres, pgadmin, portainer, netdata, nginx)
- [ ] Nginx конфиг настроен: SSL, статика, /api/, /socket.io/, поддомены инструментов
- [ ] A-записи DNS настроены для engbotai.ru и всех поддоменов
- [ ] SSL сертификат Let's Encrypt получен и автообновляется через systemd таймер
- [ ] .htpasswd создан для защиты pgadmin/portainer/netdata
- [ ] Клиент собран: client/dist заполнен
- [ ] pgAdmin доступен по защищённому URL
- [ ] Portainer доступен по защищённому URL
- [ ] Netdata доступен по защищённому URL
- [ ] Prisma схема определена, первая миграция применена
- [ ] .env.example создан с документацией всех переменных (server и client)
- [ ] Firebase Auth настроен: Email/Password и Phone включены в консоли
- [ ] Service account JSON получен и значения перенесены в server/.env
- [ ] Клиентские Firebase-переменные добавлены в client/.env
