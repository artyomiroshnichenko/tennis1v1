import { WebSocketServer } from 'ws';
import { Room } from './game/room.js';

const PORT = process.env.PORT || 3001;
const wss = new WebSocketServer({ port: PORT });

const rooms = new Map();

wss.on('connection', (ws) => {
  let room = null;
  let playerSide = null;

  // Find a waiting room or create one
  for (const [id, r] of rooms) {
    if (!r.isFull()) {
      room = r;
      break;
    }
  }
  if (!room) {
    room = new Room();
    rooms.set(room.id, room);
  }

  playerSide = room.join(ws);
  ws.send(JSON.stringify({ type: 'joined', side: playerSide, roomId: room.id }));

  if (room.isFull()) {
    room.start();
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      room.handleMessage(playerSide, msg);
    } catch {}
  });

  ws.on('close', () => {
    room.leave(playerSide);
    if (room.isEmpty()) rooms.delete(room.id);
  });
});

console.log(`tennis1v1 server listening on ws://localhost:${PORT}`);
