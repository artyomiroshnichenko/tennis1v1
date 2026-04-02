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

### Требования
- Node.js 20+
- Docker + docker-compose
- Git

### Первый запуск

```bash
# Клонировать репозиторий
git clone git@github.com:...tennis1v1.git
cd tennis1v1

# Запустить инфраструктуру локально (PostgreSQL)
docker-compose -f docker-compose.dev.yml up -d

# Установить зависимости сервера
cd server && npm install

# Применить миграции БД
npx prisma migrate dev

# Запустить сервер
npm run dev

# В отдельном терминале — запустить клиент
cd ../client && npm install && npm run dev
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

- [ ] Локальная разработка поднимается командой из раздела «Первый запуск»
- [ ] docker-compose.dev.yml настроен для локальной разработки
- [ ] docker-compose.prod.yml настроен для продакшена
- [ ] Nginx конфиг настроен: SSL, статика, /api/, /socket.io/
- [ ] Let's Encrypt сертификат получен и автообновляется
- [ ] pgAdmin доступен по защищённому URL
- [ ] Portainer доступен по защищённому URL
- [ ] Netdata доступен по защищённому URL
- [ ] Prisma схема определена, первая миграция применена
- [ ] .env.example создан с документацией всех переменных
