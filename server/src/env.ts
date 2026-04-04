import { config } from 'dotenv'
import path from 'path'

/**
 * Загружает server/.env независимо от process.cwd() (иначе при запуске из
 * корня репозитория Prisma не видит DATABASE_URL и гостевой /auth/guest падает).
 */
const envPath = path.resolve(__dirname, '..', '.env')
config({ path: envPath, quiet: true })
