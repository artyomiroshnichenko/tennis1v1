import { Prisma } from '@prisma/client'

/** Ошибки «БД недоступна / схема не готова» — для dev-fallback без PostgreSQL. */
export function isDatabaseUnavailableError(e: unknown): boolean {
  if (e instanceof Prisma.PrismaClientInitializationError) return true
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    return ['P1001', 'P1002', 'P1017', 'P2021', 'P2010'].includes(e.code)
  }
  if (e instanceof Error) {
    const m = e.message
    if (
      /P1001|Can't reach database|ECONNREFUSED|ENOTFOUND|getaddrinfo|connect ECONNREFUSED|Connection refused/i.test(
        m,
      )
    ) {
      return true
    }
  }
  return false
}

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
    // Таблицы отсутствуют / схема не применена
    if (['P2021', 'P2010'].includes(e.code)) {
      return {
        status: 503,
        code: 'DATABASE_SCHEMA',
        message:
          'Схема базы не готова. Из каталога server выполните: npm run db:migrate (нужен запущенный PostgreSQL, см. docker-compose.dev.yml).',
      }
    }
  }
  return null
}
