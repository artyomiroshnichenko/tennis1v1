# API — Tennis 1v1

## Контекст

Продукт использует два канала связи: REST API (HTTP) для авторизации, профиля и истории, и WebSocket (Socket.io) для реалтайм игрового взаимодействия. Все WebSocket события строго разделены на клиентские (client → server) и серверные (server → client).

---

## План

### REST API (Express)

Базовый URL: `/api/v1`

#### Авторизация

| Метод | Путь | Описание |
|---|---|---|
| POST | `/auth/firebase` | Верификация Firebase токена, выдача JWT |
| POST | `/auth/guest` | Создание гостевой сессии с никнеймом |
| POST | `/auth/refresh` | Обновление JWT по refresh token |
| POST | `/auth/logout` | Выход, инвалидация токена |

#### Профиль

| Метод | Путь | Описание |
|---|---|---|
| GET | `/profile/me` | Получить свой профиль |
| GET | `/profile/nickname/check?value=...` | Проверить уникальность никнейма — `{ available: boolean }` |
| PATCH | `/profile/nickname` | Изменить никнейм |

#### История матчей

| Метод | Путь | Описание |
|---|---|---|
| GET | `/matches/history` | Последние 100 матчей текущего пользователя |

#### Администратор

| Метод | Путь | Описание |
|---|---|---|
| GET | `/admin/stats` | Статистика за день / неделю / всё время |
| GET | `/admin/matches` | Журнал матчей с фильтром по дате |
| GET | `/admin/players` | Список игроков со статистикой |
| GET | `/admin/active` | Активные матчи и игроки онлайн |

---

### Коды ошибок REST

Все ошибки возвращаются в формате `{ error: string, code: string }`.

| HTTP статус | code | Когда возникает |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Невалидные данные запроса (никнейм не прошёл валидацию, отсутствует поле) |
| 401 | `UNAUTHORIZED` | Отсутствует или просрочен JWT / Firebase токен невалиден |
| 403 | `FORBIDDEN` | Нет прав (обычный пользователь обращается к `/admin/*`) |
| 404 | `NOT_FOUND` | Ресурс не найден |
| 409 | `NICKNAME_TAKEN` | Никнейм уже занят другим зарегистрированным пользователем |
| 429 | `RATE_LIMIT` | Превышен лимит запросов |
| 500 | `INTERNAL_ERROR` | Внутренняя ошибка сервера |

---

### WebSocket Events (Socket.io)

#### Формат ошибок WebSocket

Сервер отправляет ошибки через событие `error` на конкретный сокет:

```typescript
socket.emit('error', { code: string, message: string })
```

| code | Когда возникает |
|---|---|
| `ROOM_NOT_FOUND` | Комната с таким кодом не существует |
| `ROOM_FULL` | В комнате уже два игрока |
| `SPECTATORS_FULL` | Достигнут лимит наблюдателей (2) |
| `NOT_IN_ROOM` | Действие требует нахождения в комнате |
| `NOT_YOUR_TURN` | Попытка подать/ударить не в свою очередь |
| `INVALID_PHASE` | Действие недопустимо в текущей фазе игры |
| `RATE_LIMITED` | Слишком частая отправка сообщений в чат |

---

#### Client → Server

| Событие | Данные | Описание |
|---|---|---|
| `room:create` | `{ nickname }` | Создать онлайн-комнату |
| `bot:start` | `{ nickname, difficulty: 'easy' \| 'medium' \| 'hard' }` | Начать матч с ботом — создаёт изолированную игровую сессию, без комнаты и кода |
| `bot:visibility` | `{ hidden: boolean }` | Бот-матч: вкладка скрыта или снова видна — при `hidden: true` сервер шлёт `game:pause` на 15 с; при `false` — `game:resume` |
| `bot:toggle_pause` | — | Бот-матч: переключить ручную паузу (на клиенте по умолчанию клавиша P); ответ — `bot:pause:state` |
| `room:join` | `{ code, nickname }` | Войти в комнату по коду |
| `room:leave` | — | Покинуть комнату |
| `room:rematch` | — | Запрос на реванш |
| `game:input:move` | `{ dx, dy }` | Направление движения игрока |
| `game:input:indicator` | `{ phase: 'direction' \| 'power', value: number }` | Нажатие индикатора удара — фаза и позиция (0–1) |
| `chat:message` | `{ text }` | Сообщение в чат комнаты: лобби (ожидание/отсчёт) и во время матча или на экране результата — всем в комнате, включая наблюдателей |
| `chat:reaction` | `{ type: 'heart' \| 'fire' \| 'cry' \| 'halo' \| 'angry' }` | Отправить реакцию |
| `spectator:join` | `{ code }` | Подключиться как наблюдатель (во время матча или на экране результата) |

#### Server → Client

| Событие | Данные | Описание |
|---|---|---|
| `room:created` | `{ code, roomId }` | Онлайн-комната создана, код для приглашения |
| `bot:started` | `{ initialState, botName }` | Бот-матч начался — возвращает имя бота и начальное состояние |
| `bot:pause:state` | `{ paused: boolean }` | Бот-матч: подтверждение ручной паузы после `bot:toggle_pause` |
| `room:joined` | `{ side: 'left' \| 'right', players, lobbyChat? }` | Подтверждение входа; `players` — `{ nickname, side }[]`; `lobbyChat` — история чата лобби для синхронизации |
| `room:full` | — | Комната заполнена |
| `room:countdown` | `{ seconds }` | Отсчёт перед стартом (15 сек) |
| `room:closed` | — | Комната закрыта |
| `game:start` | `{ initialState }` | Матч начался |
| `game:state` | `{ ball, players, score, serving }` | Состояние игры ~60fps |
| `game:point` | `{ scorer, score, reason }` | Очко засчитано |
| `game:serve:prompt` | `{ side }` | Приглашение выполнить подачу |
| `game:indicator:show` | `{ phase: 'direction' \| 'power' }` | Показать индикатор — клиент запускает анимацию полосы |
| `game:event` | `{ type: 'ace' \| 'net' \| 'out' \| 'let' \| 'fault' }` | Игровое событие |
| `game:sides:change` | — | Смена сторон |
| `game:pause` | `{ reason: 'disconnect', seconds, source?: 'peer' \| 'tab' }` | Пауза с обратным отсчётом: `peer` — отключился соперник в онлайн-матче (ожидание до завершения); `tab` — бот-матч, скрыта вкладка |
| `game:resume` | `{}` (или пустое тело) | Матч продолжается; после паузы `peer` — перед `game:over`; в бот-матче при возврате на вкладку до истечения 15 с |
| `game:over` | `{ winner, sets, reason, technical? }` | Матч завершён; `technical` — отключение соперника |
| `room:rematch:state` | `{ youReady, peerReady }` | Согласие на реванш (только игрокам) |
| `spectator:joined` | `{ players, phase, matchChat }` | Наблюдатель в комнате; `phase`: `playing` \| `result`; `matchChat` — сообщения с начала текущего матча (и экрана результата) |
| `chat:message` | `{ from, text, timestamp }` | Новое сообщение в чате (текст уже с маскировкой запрещённых слов на сервере) |
| `chat:reaction` | `{ from, type, timestamp, anchor }` | Реакция; `type`: `heart` \| `fire` \| `cry` \| `halo` \| `angry`; `anchor`: `left` \| `right` (игрок) \| `spectator` |
| `spectator:count` | `{ count }` | Обновление числа наблюдателей |

---

### Общие типы данных

```typescript
type GameState = {
  ball: { x: number; y: number; vx: number; vy: number }
  players: {
    left: { x: number; y: number; state: PlayerState }
    right: { x: number; y: number; state: PlayerState }
  }
  score: Score
  serving: 'left' | 'right'
  phase: 'serving' | 'playing' | 'pause' | 'over'
}

type Score = {
  sets: [number, number][]
  games: [number, number]
  points: [number, number]
  isTiebreak: boolean
  isDeuce: boolean
  advantage: 'left' | 'right' | null
}

type PlayerState = 'idle' | 'running' | 'hitting' | 'serving'
```

---

## Чеклист

- [ ] REST API реализован с базовым URL /api/v1
- [ ] Все ошибки возвращают `{ error: string, code: string }` с соответствующим HTTP статусом
- [ ] 409 NICKNAME_TAKEN возвращается при занятом никнейме на регистрации и смене
- [ ] 401 UNAUTHORIZED возвращается при отсутствии или просроченном JWT
- [ ] JWT авторизация применяется на все защищённые эндпоинты
- [ ] Firebase токен верифицируется на /auth/firebase
- [ ] Гостевая сессия выдаётся на /auth/guest
- [ ] Эндпоинт /profile/nickname/check возвращает { available: boolean } до сохранения
- [x] Бот-матч стартует через `bot:start` — отдельная изолированная сессия без кода комнаты
- [x] `bot:started` возвращает имя бота (случайное по уровню сложности) и начальное состояние игры
- [x] Бот-матч: `bot:visibility`, `bot:toggle_pause`, `bot:pause:state` согласованы с клиентом
- [ ] Удар реализован двухфазно: сначала `game:indicator:show { phase: 'direction' }`, затем `game:indicator:show { phase: 'power' }` — клиент отвечает `game:input:indicator` на каждую фазу
- [ ] Все Socket.io события реализованы согласно спецификации
- [ ] Ошибки WebSocket отправляются через событие `error` в формате `{ code, message }`
- [ ] Типы GameState, Score, PlayerState используются на клиенте и сервере
- [ ] Admin эндпоинты защищены проверкой роли admin
