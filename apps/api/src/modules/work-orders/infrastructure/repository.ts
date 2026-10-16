import { PrismaClient, Prisma } from '@prisma/client';
import { workOrderSchema } from '@gc/contracts';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import type {
  WorkOrderRecord,
  WorkOrderRepository,
} from '../application/ports.js';

export function createWorkOrderDatabase(url: string) {
  const target = new URL(url);
  if (target.protocol !== 'mysql:')
    throw new Error('Unsupported database protocol');
  const adapter = new PrismaMariaDb({
    host: target.hostname,
    port: Number(target.port || '3306'),
    user: decodeURIComponent(target.username),
    password: decodeURIComponent(target.password),
    database: target.pathname.slice(1),
    connectionLimit: 4,
  });
  const client = new PrismaClient({ adapter });
  const repository: WorkOrderRepository = {
    async list() {
      const records = await client.workOrder.findMany({
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });
      return records.map(({ createdBy, ...record }) => ({
        ...workOrderSchema.parse({
          ...record,
          dueDate: record.dueDate.toISOString().slice(0, 10),
          createdAt: record.createdAt.toISOString(),
        }),
        createdBy,
      }));
    },
    async insert(record: WorkOrderRecord) {
      try {
        await client.workOrder.create({
          data: {
            ...record,
            dueDate: new Date(`${record.dueDate}T00:00:00.000Z`),
            createdAt: new Date(record.createdAt),
          },
        });
        return true;
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        )
          return false;
        throw error;
      }
    },
  };
  return { client, repository, close: () => client.$disconnect() };
}
