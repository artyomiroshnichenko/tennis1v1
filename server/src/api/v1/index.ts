import { Router } from 'express'
import { authRouter } from './authRoutes'
import { matchesRouter } from './matchesRoutes'
import { profileRouter } from './profileRoutes'

export const apiV1Router = Router()

apiV1Router.use('/auth', authRouter)
apiV1Router.use('/profile', profileRouter)
apiV1Router.use(matchesRouter)
