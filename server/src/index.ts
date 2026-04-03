import cors from 'cors'
import express from 'express'
import { createServer } from 'http'
import { Server } from 'socket.io'
import { apiV1Router } from './api/v1'
import { registerLobbySocket } from './socket/lobbySocket'

const app = express()
const httpServer = createServer(app)
const io = new Server(httpServer, {
  cors: { origin: process.env.CLIENT_URL ?? 'http://localhost:5173' }
})

const PORT = process.env.PORT ?? 3000

app.use(
  cors({
    origin: process.env.CLIENT_URL ?? true,
    credentials: true,
  }),
)
app.use(express.json())
app.use('/api/v1', apiV1Router)

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' })
})

registerLobbySocket(io)

httpServer.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`)
})
