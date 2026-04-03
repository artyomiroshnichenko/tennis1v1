# Handoff для следующего агента (после эпиков 01–04)

Технический контекст для продолжения с **эпика 05** (и далее по PRD). Источник правды по продукту — `docs/business/PRD.md` и `epic-NN-*.md`; по протоколу и стеку — `docs/dev/API.md`, `ARCHITECTURE.md`, `GDD.md`, `DEVGUIDE.md`.

---

## Обязательная сверка с чеклистом эпика (после каждой реализации)

1. Открыть соответствующий **`docs/business/epic-NN-*.md`** и раздел **«Чеклист»**.
2. Пройти **каждый** пункт: код + ручной сценарий (или автотест, если есть). Не закрывать эпик «на глаз».
3. При расхождении: либо доработать код, либо явно зафиксировать отложенное решение в **`docs/dev/BACKLOG.md`** с отсылкой к номеру эпика и пункту чеклиста.
4. После подтверждения готовности — отметить пункты чеклиста в бизнес-файле (`[x]`), не добавляя в `docs/business/` технических деталей.

То же правило действует для агента, **продолжающего** чужую реализацию: первым делом сверить чеклист уже сданного эпика и зафиксировать остатки.

---

## Сделано (код и документы)

### Эпик 01 — доступ и идентификация (закрыт)

- REST `/api/v1`: `auth/guest`, `auth/firebase`, `auth/refresh`, `auth/logout`; `profile/me`, `profile/nickname/check`, `profile/nickname`; `matches/history` (только зарегистрированный).
- Prisma: `User`, `Match`, `MatchPlayer`, `RefreshToken`. Миграция `20250404180000_init`.
- Клиент: главная, гость, Firebase, профиль, история в модалке и на странице (см. эпик 04).

### Эпик 02 — лобби (закрыт)

- Socket.io: JWT в `handshake.auth.token` (или `query.token`). `server/src/socket/lobbySocket.ts`, `server/src/rooms/RoomManager.ts`.
- События лобби: `room:create`, `room:join`, `room:leave`, `chat:message`; ответы `room:created`, `room:joined` (`lobbyChat`), `room:countdown`, `room:closed`; ошибки `error` `{ code, message }`.
- Лимиты комнат — см. `ARCHITECTURE.md`.
- Клиент: `client/src/app/lobbyScreen.ts`, `client/src/net/gameSocket.ts`, `?room=КОД`.

### Эпик 03 — игровой процесс (закрыт по чеклисту в `docs/business/epic-03-game.md`)

**Сервер (авторитетный матч ~60 Hz):**

- `server/src/game/constants.ts`, `geometry.ts`, `scoring.ts`, `types.ts` — корт, счёт, типы wire.
- `server/src/game/matchEngine.ts` — фазы подачи/ралли/пауза очка/смена сторон, физика мяча с высотой и сеткой, ввод индикаторов.
- `server/src/game/MatchController.ts` — тик, эмиты `game:start`, `game:state`, `game:point` (с полем `score`), `game:event`, `game:serve:prompt`, `game:indicator:show`, `game:sides:change`, `game:over` (в т.ч. `technical`); старт после отсчёта лобби; `getWireState()` для поздних наблюдателей.
- `server/src/rooms/RoomManager.ts` — фазы комнаты включая `result`, реванш, наблюдатели; после `finishCountdown` — `MatchController`; `handleGameInputMove` / `handleGameInputIndicator`; при `room:leave` во время матча — победа сопернику (`forfeitDisconnected`).
- `server/src/socket/lobbySocket.ts` — обработчики `game:input:*`, `room:rematch`, `spectator:join`.

**Клиент:**

- `client/src/game/matchScene.ts` — Phaser: корт, смена сторон, ввод, индикаторы, режим наблюдателя (`spectator`).
- `client/src/game/matchAudio.ts` — синтетические звуки (бэклог на файлы).
- `client/src/game/startPhaser.ts` — `startOnlineMatch`, `destroyGame`.
- `client/src/game/gameTypes.ts` — типы состояния.

**Вне объёма эпика 03:** полноценный бот (`bot:start` — **эпик 05**). Пауза при обрыве соперника и сценарии наблюдателя — **эпики 06+**. Базовые наблюдатели онлайн-матча — **эпик 04**.

### Эпик 04 — экран результата и история (закрыт по чеклисту в `docs/business/epic-04-results.md`)

- **Сервер:** запись `Match` + `MatchPlayer` при `game:over` (`server/src/match/persistOnlineMatch.ts`), гость как соперник через `guestNickname`; миграция `20260404120000_match_player_guest` (опциональный `userId`).
- **Комната:** фаза `result`, `room:rematch`, `room:rematch:state`, повторный `room:join` в `result`, `spectator:join` / `spectator:joined`, лимит наблюдателей 2.
- **Клиент:** полноэкранный результат (зелёный/красный), реванш, отсчёт повторного старта на `#game`; наблюдатель `?room=CODE&watch=1` (`openSpectatorJoin`); страница истории `?history=1`, кнопка на главной для пользователя; расширенный `GET /matches/history`.
- **Документация:** `docs/dev/API.md` (события и payload).

**Ориентир по коммиту:** `72d4f92` (эпик 04 целиком).

#### Нюансы относительно формулировок эпика 04 (для сверки)

- **«Последние 100 матчей»:** в API и UI выдаётся не более 100 записей (`take: 100`); **отдельная очистка** старых строк в БД не делалась. Если понадобится жёсткий потолок хранения — задача на доработку + запись в `BACKLOG.md`.
- **Приглашение зрителю:** в лобби хоста есть вторая строка «Ссылка для зрителя» с `&watch=1` и кнопка копирования.

### Коммиты (ориентир по `main`)

- Эпик 03 (движок + клиент): `792087a`; смена сторон + звуки: `e561c08`.
- Эпик 04: `72d4f92`.

---

## Текущее состояние vs целевое (ARCHITECTURE / PRD)

| Тема | Сейчас | Цель / следующий эпик |
|------|--------|------------------------|
| Результат и история онлайн | Экран результата, реванш, БД, история, наблюдатели (эпик 06) | Поддержка и полировка по обратной связи |
| Игра с ботом | `bot:start`, `BotMatchController`, модалка уровней, история с типом BOT | Полировка по обратной связи |
| Звуки матча | Синтез Web Audio | **BACKLOG** `ENG-GAME-AUDIO-FILES` |
| Точность отскока (звук) | Эвристика по `vy` | **BACKLOG** `ENG-GAME-BOUNCE-EVENT` |
| Ассеты спрайтов | Нет | Отдельные задачи / эпики |
| Масштабирование комнат | In-memory одного процесса | Redis adapter в ARCHITECTURE |

---

## Что намеренно не сделано / отложено

- **Прод HTTPS / домен**: `docs/dev/BACKLOG.md` (ENG-PROD-HTTPS).
- **RATE_LIMIT** на REST (кроме антиспама комнат на сокетах).
- **README** может отставать; ориентир — код и `docs/dev/*`.
- **Легаси**: `server/index.js`, `server/game/room.js` не entrypoint; актуально `server/src/index.ts`.

---

### Эпик 07 — чат (закрыт по чеклисту в `docs/business/epic-07-chat.md`)

- Сервер: `matchChat` в комнате (сообщения с начала матча + экран результата), `maskBannedWords`, лимит 200 символов и 3 сообщения / 5 с, реакции `chat:reaction` (1 / 5 с), `spectator:joined.matchChat`.
- Клиент: `client/src/ui/roomChat.ts`, чат в лобби (сворачивание по умолчанию развёрнут) и на `#game`, реакции в `matchScene` (Phaser + `matchAudio`).

## Следующий логичный шаг: эпик 08 и далее по PRD

Эпики **06–07** закрыты по бизнес-чеклистам. Протокол — **`docs/dev/API.md`**.

Зависимости: эпики **08–09** — по PRD; эпики **01–07** закрыты в `main`.

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
- БД: `cd server && npx prisma studio`.

---

## Правила работы в репозитории

- Перед реализацией — контекст → план → чеклист (`.cursor/rules/workflow.mdc`).
- **`docs/business/`** — только бизнес-язык; **`docs/dev/`** — техника; не смешивать.
- Коммиты и пуши — логическими порциями.
- **После реализации эпика** — обязательная сверка с чеклистом в `docs/business/epic-NN-*.md` (см. начало этого файла).

---

## Чеклист для нового агента в первом сообщении чата

- [ ] Прочитать **`docs/dev/AGENT_HANDOFF.md`** (этот файл), раздел про сверку с бизнес-чеклистом.
- [ ] Открыть следующий **`docs/business/epic-NN-*.md`** по PRD (например **`epic-08-disconnect.md`**) и чеклист.
- [ ] Сверить **`docs/dev/API.md`** и код под выбранный эпик.
- [ ] Просмотреть **`docs/dev/BACKLOG.md`** — не смешивать с объёмом эпика без явного запроса.
- [ ] Не опираться на README без сверки с кодом.

Краткая формулировка для старта чата:

> Продолжи Tennis 1v1 со следующего эпика по PRD. Прочитай `docs/dev/AGENT_HANDOFF.md` и соответствующий `docs/business/epic-NN-*.md`. В `main` уже эпики 01–07.
