import { Prisma } from '@prisma/client'

/**
 * Maps Prisma connectivity / availability errors to an API-friendly shape.
 * Other errors return null — caller should log and return generic 500.
 */
export function prismaToApiError(e: unknown): { status: number; code: string; message: string } | null {
  if (e instanceof Prisma.PrismaClientInitializationError) {
    return {
      status: 503,
      code: 'DATABASE_UNAVAILABLE',
      message:
        'База данных недоступна. Запустите PostgreSQL (например docker compose -f docker-compose.dev.yml up -d), проверьте DATABASE_URL в server/.env и из каталога server выполните: npm ci && npm run db:migrate',
    }
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (['P1001', 'P1002', 'P1017'].includes(e.code)) {
      return {
        status: 503,
        code: 'DATABASE_UNAVAILABLE',
        message:
          'Не удаётся подключиться к базе данных. Убедитесь, что PostgreSQL запущен, DATABASE_URL в server/.env совпадает с контейнером и миграции применены (cd server && npm ci && npm run db:migrate).',
      }
    }
  }
  return null
}
