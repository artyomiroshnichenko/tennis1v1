# Handoff для следующего агента (после эпиков 01–02)

Технический контекст и задачи для продолжения с эпика 03. Источник правды по продукту — `docs/business/PRD.md` и `epic-NN-*.md`; по протоколу и стеку — `docs/dev/API.md`, `ARCHITECTURE.md`, `GDD.md`, `DEVGUIDE.md`.

---

## Сделано (код и документы)

### Эпик 01 — доступ и идентификация (закрыт)

- REST `/api/v1`: `auth/guest`, `auth/firebase`, `auth/refresh`, `auth/logout`; `profile/me`, `profile/nickname/check`, `profile/nickname`; `matches/history` (только зарегистрированный).
- Prisma: `User`, `Match`, `MatchPlayer`, `RefreshToken` (+ `payload` для гостя при refresh). Миграция `20250404180000_init`.
- Клиент: главная, гость (localStorage + JWT), Firebase email/телефон, профиль и история (в модалке), два действия «Создать игру» / «Играть с ботом».
- Клиент `tsconfig`: `noEmit: true` (только Vite собирает бандл).

### Эпик 02 — лобби (закрыт)

- Socket.io: JWT в `handshake.auth.token` (или `query.token`). Обработчики в `server/src/socket/lobbySocket.ts`, логика комнат в `server/src/rooms/RoomManager.ts`.
- События: `room:create`, `room:join`, `room:leave`, `chat:message` (лобби); ответы `room:created`, `room:joined` (в т.ч. `lobbyChat`), `room:countdown`, `room:closed`, `game:start` (заглушка), ошибки через `error` `{ code, message }`.
- Лимиты (ARCHITECTURE): до 3 активных комнат на субъект (по `creatorSubjectId`), до 10 созданий комнат с IP за 10 мин, закрытие комнаты через 5 мин без второго игрока; чат в лобби с rate limit на сокет.
- Клиент: `client/src/app/lobbyScreen.ts`, `net/gameSocket.ts`, вход по `?room=КОД`; после отсчёта 15 с — Phaser-заглушка `online` в `game/startPhaser.ts`.

### Коммиты (ориентир)

- Эпик 01: см. историю `main` (крупный коммит auth + клиент).
- Эпик 02: `711d0d1` (сервер лобби), `004f68b` (клиент лобби + API/epic чеклисты).

---

## Текущее состояние vs целевое (ARCHITECTURE)

| Тема | Сейчас | Цель из ARCHITECTURE / GDD |
|------|--------|----------------------------|
| Рендер игры | Phaser 3, сцена-заглушка после лобби/бота | Полноценные сцены, ассеты по `assets.config.ts` (ещё не заведён) |
| Авторитетность | После `game:start` симуляции нет | Server-authoritative ~60 Hz, клиент только input + рендер |
| Бот | Кнопка ведёт в локальную заглушку, без `bot:start` | Эпик 05, Socket `bot:start` / `bot:started` |
| Матч в БД | Схема есть, запись матчей из игры не подключена | Эпик 04 и игровой движок на сервере |

---

## Что намеренно не сделано / отложено

- **Прод HTTPS / домен**: `docs/dev/BACKLOG.md` (ENG-PROD-HTTPS); проверка — преимущественно локально (`DEVGUIDE.md`).
- **RATE_LIMIT** на REST (кроме логики спама комнат на сокетах) — в API описан, на `/auth` массово не вешали.
- **README** может отставать; ориентир — код и `docs/dev/*`.
- **Легаси**: `server/index.js`, `server/game/room.js` (старый ws) не entrypoint Docker; актуально `server/src/index.ts`.

---

## Следующий логичный шаг: эпик 03 (игровой процесс)

1. Прочитать **`docs/business/epic-03-game.md`** целиком и **`docs/dev/GDD.md`** (релевантные разделы).
2. Связать с **`docs/dev/API.md`**: `game:input:move`, `game:input:indicator`, серверные `game:state`, `game:start`, `game:point`, `game:serve:prompt`, `game:indicator:show`, `game:event`, `game:sides:change`, `game:pause`/`resume`, `game:over`.
3. **Сервер**: выделить модуль игрового цикла (тик ~60 Hz в памяти процесса или setInterval с фиксированным dt), привязка к «комнате после лобби» (сейчас комнаты in-memory; после `game:start` нужна жизнь сессии матча и маршрутизация событий по `room:id` или отдельному match id).
4. **Клиент**: заменить заглушку Phaser на сцену матча; ввод с клавиатуры и позже мобильный ввод по эпику; индикаторы направления/силы в два этапа (как в API и GDD).
5. **Синхронизация с эпиком 02**: сокеты уже в одной комнате Socket.io после join; не ломать контракт `room:leave` / disconnect до появления явной модели «матч идёт».

Зависимости: эпики **04** (результат + история в UI), **05** (бот), **06–09** — по PRD; часть может идти параллельно после появления ядра матча.

---

## Локальный запуск (кратко)

```bash
docker compose -f docker-compose.dev.yml up -d
# server/.env — DATABASE_URL, JWT_SECRET, Firebase (для регистрации)
cd server && npm install && npx prisma migrate deploy && npm run dev
# client/.env — Firebase web (опционально для входа)
cd client && npm install && npm run dev
```

- Клиент: `http://localhost:5173` (прокси `/api`, `/socket.io` → `:3000`).
- БД: Prisma Studio `cd server && npx prisma studio`.

---

## Правила работы в репозитории

- В Cursor: перед реализацией — контекст → план → чеклист (см. `.cursor/rules/workflow.mdc`).
- Документы: **`docs/business/`** — только бизнес-язык; **`docs/dev/`** — техника; не смешивать.
- Коммиты и пуши — логическими порциями; после деплоя на VPS пользователь обновляет код вручную (`git pull`, пересборка контейнеров по `docker-compose.prod.yml`).

---

## Чеклист для нового агента в первом сообщении чата

- [ ] Открыть `docs/business/epic-03-game.md` (или следующий выбранный эпик).
- [ ] Сверить `docs/dev/API.md` и `ARCHITECTURE.md` для server-authoritative и сокетов.
- [ ] Не опираться на README без сверки с кодом.
- [ ] Прод-домен и HTTPS — только после `BACKLOG.md`; разработка локально.
