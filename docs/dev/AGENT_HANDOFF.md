# Handoff для следующего агента (после эпиков 01–03)

Технический контекст для продолжения с **эпика 04** (и далее по PRD). Источник правды по продукту — `docs/business/PRD.md` и `epic-NN-*.md`; по протоколу и стеку — `docs/dev/API.md`, `ARCHITECTURE.md`, `GDD.md`, `DEVGUIDE.md`.

---

## Сделано (код и документы)

### Эпик 01 — доступ и идентификация (закрыт)

- REST `/api/v1`: `auth/guest`, `auth/firebase`, `auth/refresh`, `auth/logout`; `profile/me`, `profile/nickname/check`, `profile/nickname`; `matches/history` (только зарегистрированный).
- Prisma: `User`, `Match`, `MatchPlayer`, `RefreshToken`. Миграция `20250404180000_init`.
- Клиент: главная, гость, Firebase, профиль и история в модалке (история наполнится после записи матчей из игры — **эпик 04**).

### Эпик 02 — лобби (закрыт)

- Socket.io: JWT в `handshake.auth.token` (или `query.token`). `server/src/socket/lobbySocket.ts`, `server/src/rooms/RoomManager.ts`.
- События лобби: `room:create`, `room:join`, `room:leave`, `chat:message`; ответы `room:created`, `room:joined` (`lobbyChat`), `room:countdown`, `room:closed`; ошибки `error` `{ code, message }`.
- Лимиты комнат — см. `ARCHITECTURE.md`.
- Клиент: `client/src/app/lobbyScreen.ts`, `client/src/net/gameSocket.ts`, `?room=КОД`.

### Эпик 03 — игровой процесс (закрыт по чеклисту в `docs/business/epic-03-game.md`)

**Сервер (авторитетный матч ~60 Hz):**

- `server/src/game/constants.ts`, `geometry.ts`, `scoring.ts`, `types.ts` — корт, счёт, типы wire.
- `server/src/game/matchEngine.ts` — фазы подачи/ралли/пауза очка/смена сторон, физика мяча с высотой и сеткой, ввод индикаторов.
- `server/src/game/MatchController.ts` — тик, эмиты `game:start`, `game:state`, `game:point` (с полем `score`), `game:event`, `game:serve:prompt`, `game:indicator:show`, `game:sides:change`, `game:over`; старт после отсчёта лобби.
- `server/src/rooms/RoomManager.ts` — после `finishCountdown` создаётся `MatchController`; `handleGameInputMove` / `handleGameInputIndicator`; при `room:leave` во время матча — победа сопернику (`forfeitDisconnected`).
- `server/src/socket/lobbySocket.ts` — обработчики `game:input:move`, `game:input:indicator`.

**Клиент:**

- `client/src/game/matchScene.ts` — Phaser: корт в `Container` (анимация переворота при смене сторон), мяч/игроки, счёт, ввод WASD/стрелки и тап по корту, оверлей индикаторов, оверлей результата через колбэк в лобби.
- `client/src/game/matchAudio.ts` — **синтетические** звуки на события (см. бэклог на замену файлами).
- `client/src/game/startPhaser.ts` — `startOnlineMatch` из лобби после `game:start`.
- `client/src/game/gameTypes.ts` — типы состояния согласно API.

**Не реализовано в рамках эпика 03 (и не требовалось чеклистом):** запись матча в БД, полноценный экран результата по эпику 04, `game:pause`/`resume` при обрыве (см. эпик 08), бот (`bot:start` — эпик 05), наблюдатели в матче (эпик 06).

### Коммиты (ориентир по `main`)

- Крупный блок эпика 03: `792087a` (движок + клиент матча).
- Анимация смены сторон + расширенные звуки: `e561c08`.

---

## Текущее состояние vs целевое (ARCHITECTURE / PRD)

| Тема | Сейчас | Цель / следующий эпик |
|------|--------|------------------------|
| Результат матча | Оверлей «Победа/Поражение» в `#game`, кнопка «На главную» | **Эпик 04**: отдельный экран результата, стили победителя/проигравшего, реванш по согласию |
| История матчей | API и модалка есть; записи не создаются из онлайн-матча | **Эпик 04**: сохранение `Match` в БД при `game:over`, связь с пользователями |
| Звуки матча | Синтез Web Audio | **BACKLOG** `ENG-GAME-AUDIO-FILES`: файлы в `public/assets/sounds` |
| Точность отскока (звук) | Эвристика по `vy` на клиенте | **BACKLOG** `ENG-GAME-BOUNCE-EVENT` (опционально) |
| Ассеты спрайтов / `assets.config.ts` | Нет | ARCHITECTURE — отдельными задачами/эпиками по визуалу |
| Бот | Заглушка на главной | **Эпик 05** |
| Наблюдатели в матче | `spectator:join` отклонён в лобби | **Эпик 06** |
| Комнаты | In-memory одного процесса | Масштабирование — Redis adapter в ARCHITECTURE |

---

## Что намеренно не сделано / отложено

- **Прод HTTPS / домен**: `docs/dev/BACKLOG.md` (ENG-PROD-HTTPS).
- **RATE_LIMIT** на REST (кроме антиспама комнат на сокетах).
- **README** может отставать; ориентир — код и `docs/dev/*`.
- **Легаси**: `server/index.js`, `server/game/room.js` не entrypoint; актуально `server/src/index.ts`.
- **Замена синтетических звуков и точный отскок** — см. новые пункты в `BACKLOG.md`.

---

## Следующий логичный шаг: эпик 04 — экран результата и история

1. Прочитать **`docs/business/epic-04-results.md`** целиком.
2. Сверить **`docs/dev/API.md`** (REST истории, при необходимости новые поля матча) и **Prisma schema** (`server/prisma/schema.prisma`) — какие поля уже есть у `Match` / `MatchPlayer`, чего не хватает для сценария эпика.
3. **Сервер**: при завершении онлайн-матча (`MatchController` / `game:over`) создать запись в БД (тип матча, участники по `subjectId` из JWT/комнаты, счёт по сетам, победитель, признак технического поражения при форфите); не ломать гостей (история только у зарегистрированных).
4. **Сокеты** (если по эпику): `room:rematch` и согласование «сыграть ещё раз» — в API.md сейчас событие упомянуто; реализации может не быть — проверить код.
5. **Клиент**: экран результата вместо или поверх текущего оверлея; зелёная/красная схема; кнопки реванша и в меню; отдельная страница/раздел истории в профиле, если эпик требует не только модалку.

Зависимости: эпики **05–09** — по PRD; **08** пересекается с «отключение соперника» (уже частично как форфит).

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

---

## Чеклист для нового агента в первом сообщении чата

- [ ] Открыть `docs/business/epic-04-results.md` и чеклист эпика.
- [ ] Прочитать обновлённый `docs/dev/AGENT_HANDOFF.md` (этот файл).
- [ ] Сверить `docs/dev/API.md`, Prisma-схему и точки входа: `MatchController`, `RoomManager`, `lobbyScreen.ts`.
- [ ] Просмотреть `docs/dev/BACKLOG.md` на предмет отложенного звука/отскока и прода — не смешивать с объёмом эпика 04 без явного запроса.
- [ ] Не опираться на README без сверки с кодом.

Краткая формулировка для старта чата:

> Продолжи Tennis 1v1 с **эпика 04**. Прочитай `docs/dev/AGENT_HANDOFF.md`, затем `docs/business/epic-04-results.md`, `docs/dev/API.md`, Prisma schema. Эпики 01–03 в `main`. История и запись матча из онлайн-игры — основной объём.
