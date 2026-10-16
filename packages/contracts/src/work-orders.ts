import { z } from 'zod';

const referenceSchema = z.string().trim().min(1).max(128);
const requiredText = (max: number) => z.string().trim().min(1).max(max);
const optionalText = (max: number) =>
  z
    .union([z.string().trim().max(max), z.null()])
    .transform((value) => value || null);
export const productionLeadSchema = z
  .object({
    id: referenceSchema,
    name: requiredText(128),
    active: z.boolean(),
  })
  .strict();
export type ProductionLead = z.infer<typeof productionLeadSchema>;

/** One work order represents one equipment item; quantities never use floating point. */
export const createWorkOrderSchema = z
  .object({
    number: requiredText(128),
    customer: requiredText(200),
    quantity: z.literal(1),
    dueDate: z.iso
      .date()
      .refine(
        (value) => value >= '1000-01-01',
        'Date is outside the database range',
      ),
    project: optionalText(200).default(null),
    division: optionalText(128).default(null),
  })
  .strict();
export type CreateWorkOrder = z.infer<typeof createWorkOrderSchema>;
export const workOrderSchema = createWorkOrderSchema
  .omit({ project: true, division: true })
  .extend({
    project: requiredText(200).nullable(),
    division: requiredText(128).nullable(),
    id: z.uuid(),
    productionLeadId: referenceSchema.nullable(),
    createdAt: z.iso.datetime(),
  })
  .strict();
export type WorkOrder = z.infer<typeof workOrderSchema>;
export const workOrderSourcesSchema = z
  .object({
    productionLeads: z.array(productionLeadSchema),
  })
  .strict();
export const workOrderListSchema = z.array(workOrderSchema);
