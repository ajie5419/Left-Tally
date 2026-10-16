import { z } from 'zod';

export const permissionSchema = z.enum([
  'work-orders:read',
  'work-orders:create',
]);
export const principalSchema = z
  .object({
    id: z.string().trim().min(1).max(128),
    name: z.string().trim().min(1).max(128),
    permissions: z.array(permissionSchema),
    accountAdmin: z.boolean().optional(),
  })
  .strict();
export type Principal = z.infer<typeof principalSchema>;
export const sessionSchema = z
  .object({
    mode: z.enum(['demo', 'production']),
    principal: principalSchema.nullable(),
    loginUrl: z.string().min(1).nullable(),
  })
  .strict();
export type Session = z.infer<typeof sessionSchema>;
export const usernameSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/);
export const passwordSchema = z.string().min(12).max(128);
export const accountSchema = z
  .object({
    id: z.uuid(),
    username: usernameSchema,
    name: z.string().trim().min(1).max(128),
    permissions: z.array(permissionSchema),
    accountAdmin: z.boolean(),
    active: z.boolean(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict();
export type Account = z.infer<typeof accountSchema>;
export const loginSchema = z
  .object({ username: usernameSchema, password: passwordSchema })
  .strict();
export const logoutSchema = z.object({}).strict();
export const createAccountSchema = z
  .object({
    username: usernameSchema,
    name: z.string().trim().min(1).max(128),
    password: passwordSchema,
    permissions: z.array(permissionSchema),
    accountAdmin: z.boolean().default(false),
  })
  .strict();
export type CreateAccount = z.infer<typeof createAccountSchema>;
export const updateAccountPermissionsSchema = z
  .object({
    permissions: z.array(permissionSchema),
    accountAdmin: z.boolean(),
  })
  .strict();
export type UpdateAccountPermissions = z.infer<
  typeof updateAccountPermissionsSchema
>;
export const resetPasswordSchema = z
  .object({ password: passwordSchema })
  .strict();
export const updateAccountActiveSchema = z
  .object({ active: z.boolean() })
  .strict();
export type UpdateAccountActive = z.infer<typeof updateAccountActiveSchema>;
export const bootstrapAdminSchema = createAccountSchema.refine(
  (input) => input.accountAdmin,
  'Bootstrap account must be an account administrator',
);
/** Retained solely for the pre-existing demonstration composition; production never mounts it. */
export const demoIdentitiesSchema = z.array(principalSchema);
export const demoLoginSchema = z
  .object({ identityId: z.string().trim().min(1).max(128) })
  .strict();
