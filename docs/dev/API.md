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

### WebSocket Events (Socket.io)

#### Client → Server

| Событие | Данные | Описание |
|---|---|---|
| `room:create` | `{ nickname }` | Создать онлайн-комнату |
| `bot:start` | `{ nickname, difficulty: 'easy' \| 'medium' \| 'hard' }` | Начать матч с ботом — создаёт изолированную игровую сессию, без комнаты и кода |
| `room:join` | `{ code, nickname }` | Войти в комнату по коду |
| `room:leave` | — | Покинуть комнату |
| `room:rematch` | — | Запрос на реванш |
| `game:input:move` | `{ dx, dy }` | Направление движения игрока |
| `game:input:indicator` | `{ phase: 'direction' \| 'power', value: number }` | Нажатие индикатора удара — фаза и позиция (0–1) |
| `chat:message` | `{ text }` | Отправить сообщение в чат |
| `chat:reaction` | `{ type: 'heart' \| 'fire' \| 'cry' \| 'halo' \| 'angry' }` | Отправить реакцию |
| `spectator:join` | `{ code }` | Подключиться как наблюдатель |

#### Server → Client

| Событие | Данные | Описание |
|---|---|---|
| `room:created` | `{ code, roomId }` | Онлайн-комната создана, код для приглашения |
| `bot:started` | `{ initialState, botName }` | Бот-матч начался — возвращает имя бота и начальное состояние |
| `room:joined` | `{ side: 'left' \| 'right', players }` | Подтверждение входа в комнату |
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
| `game:pause` | `{ reason: 'disconnect', seconds }` | Пауза с обратным отсчётом |
| `game:resume` | — | Матч продолжается |
| `game:over` | `{ winner, sets, reason }` | Матч завершён |
| `chat:message` | `{ from, text, timestamp }` | Новое сообщение в чате |
| `chat:reaction` | `{ from, type }` | Реакция от участника |
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
- [ ] JWT авторизация применяется на все защищённые эндпоинты
- [ ] Firebase токен верифицируется на /auth/firebase
- [ ] Гостевая сессия выдаётся на /auth/guest
- [ ] Эндпоинт /profile/nickname/check возвращает { available: boolean } до сохранения
- [ ] Бот-матч стартует через `bot:start` — отдельная изолированная сессия без кода комнаты
- [ ] `bot:started` возвращает имя бота (случайное по уровню сложности) и начальное состояние игры
- [ ] Удар реализован двухфазно: сначала `game:indicator:show { phase: 'direction' }`, затем `game:indicator:show { phase: 'power' }` — клиент отвечает `game:input:indicator` на каждую фазу
- [ ] Все Socket.io события реализованы согласно спецификации
- [ ] Типы GameState, Score, PlayerState используются на клиенте и сервере
- [ ] Admin эндпоинты защищены проверкой роли admin
