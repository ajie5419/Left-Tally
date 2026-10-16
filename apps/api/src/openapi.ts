import {
  z,
  healthOpenApi,
  sessionSchema,
  createWorkOrderSchema,
  workOrderListSchema,
  workOrderSourcesSchema,
  failureResponseSchema,
  accountSchema,
  createAccountSchema,
  loginSchema,
  logoutSchema,
  resetPasswordSchema,
  updateAccountActiveSchema,
  updateAccountPermissionsSchema,
} from '@gc/contracts';

const json = (schema: z.ZodType, io: 'input' | 'output' = 'output') => ({
  'application/json': { schema: z.toJSONSchema(schema, { io }) },
});
const success = (schema: z.ZodType) =>
  json(
    z
      .object({
        success: z.literal(true),
        data: schema,
        timestamp: z.iso.datetime(),
      })
      .strict(),
  );
const accountId = [
  {
    name: 'id',
    in: 'path',
    required: true,
    description: 'Local account UUID',
    schema: { type: 'string', format: 'uuid' },
  },
];
const failures = {
  '400': {
    description: 'Invalid input or malformed JSON',
    content: json(failureResponseSchema),
  },
  '403': {
    description: 'Unauthenticated, forbidden or invalid write Origin',
    content: json(failureResponseSchema),
  },
  '503': {
    description: 'Local account persistence or personnel source is unavailable',
    content: json(failureResponseSchema),
  },
};
export const businessOpenApi = {
  ...healthOpenApi,
  info: { title: 'Grand Comptroller B01 API', version: '0.2.0' },
  'x-authentication': {
    status: 'gc-local-account',
    description:
      'GC verifies its own opaque, hashed persistent sessions against local active accounts and current permissions. QMS does not participate in login, validity or authorization. No identity header is accepted.',
  },
  paths: {
    ...healthOpenApi.paths,
    '/api/auth/login': {
      post: {
        summary:
          'Local username/password login with an opaque GC session cookie',
        requestBody: {
          required: true,
          content: json(loginSchema, 'input'),
        },
        responses: {
          '200': {
            description:
              'Authenticated principal and HttpOnly Secure Lax session cookie',
            content: success(
              z
                .object({ principal: sessionSchema.shape.principal.unwrap() })
                .strict(),
            ),
          },
          '400': failures['400'],
          '403': failures['403'],
          '503': failures['503'],
        },
      },
    },
    '/api/auth/logout': {
      post: {
        summary:
          'Same-origin GC logout; session is revoked before the cookie is cleared',
        requestBody: {
          required: true,
          content: json(logoutSchema, 'input'),
        },
        responses: {
          '200': {
            description: 'Local session revoked and cookie cleared',
            content: success(z.object({ loggedOut: z.literal(true) }).strict()),
          },
          '403': failures['403'],
          '503': failures['503'],
        },
      },
    },
    '/api/session': {
      get: {
        summary:
          'Current verified principal, local permissions and login entry',
        responses: {
          '200': {
            description:
              'Anonymous principal is null; no credential is returned',
            content: success(sessionSchema),
          },
          '503': failures['503'],
        },
      },
    },
    '/api/accounts': {
      get: {
        summary:
          'List local accounts; requires account administrator capability',
        'x-required-capability': 'account-admin',
        responses: {
          '200': {
            description: 'No password hashes or sessions',
            content: success(accountSchema.array()),
          },
          ...failures,
        },
      },
      post: {
        summary:
          'Create local account; requires account administrator capability',
        'x-required-capability': 'account-admin',
        requestBody: {
          required: true,
          content: json(createAccountSchema, 'input'),
        },
        responses: {
          '201': {
            description: 'Account created',
            content: success(accountSchema),
          },
          ...failures,
          '409': {
            description: 'ACCOUNT_USERNAME_EXISTS',
            content: json(failureResponseSchema),
          },
        },
      },
    },
    '/api/accounts/{id}/permissions': {
      put: {
        summary: 'Set read/create permissions and account-admin capability',
        'x-required-capability': 'account-admin',
        parameters: accountId,
        requestBody: {
          required: true,
          content: json(updateAccountPermissionsSchema, 'input'),
        },
        responses: {
          '200': {
            description: 'Account updated and its sessions revoked',
            content: success(accountSchema),
          },
          ...failures,
          '409': {
            description: 'ACCOUNT_LAST_ADMIN',
            content: json(failureResponseSchema),
          },
        },
      },
    },
    '/api/accounts/{id}/reset-password': {
      post: {
        summary: 'Reset a password and revoke its sessions',
        'x-required-capability': 'account-admin',
        parameters: accountId,
        requestBody: {
          required: true,
          content: json(resetPasswordSchema, 'input'),
        },
        responses: {
          '200': {
            description: 'Account updated',
            content: success(accountSchema),
          },
          ...failures,
        },
      },
    },
    '/api/accounts/{id}/active': {
      put: {
        summary: 'Enable or disable a local account',
        'x-required-capability': 'account-admin',
        parameters: accountId,
        requestBody: {
          required: true,
          content: json(updateAccountActiveSchema, 'input'),
        },
        responses: {
          '200': {
            description: 'Account updated and its sessions revoked',
            content: success(accountSchema),
          },
          ...failures,
          '409': {
            description: 'ACCOUNT_LAST_ADMIN',
            content: json(failureResponseSchema),
          },
        },
      },
    },
    '/api/work-orders': {
      get: {
        summary: 'Read local equipment work orders; requires work-orders:read',
        'x-required-permissions': ['work-orders:read'],
        responses: {
          '200': {
            description:
              'Local work orders; productionLeadId is null before production assignment',
            content: success(workOrderListSchema),
          },
          ...failures,
        },
      },
      post: {
        summary:
          'Create local equipment work order; requires work-orders:create',
        'x-required-permissions': ['work-orders:create'],
        requestBody: {
          required: true,
          content: json(createWorkOrderSchema, 'input'),
        },
        responses: {
          '201': {
            description: 'Created; actor and time are supplied by the server',
            content: success(z.object({ id: z.uuid() }).strict()),
          },
          ...failures,
          '409': {
            description: 'WORK_ORDER_NUMBER_EXISTS: number already exists',
            content: json(failureResponseSchema),
          },
        },
      },
    },
    '/api/work-orders/sources': {
      get: {
        summary:
          'Resolve active/inactive personnel for display; requires work-orders:read',
        'x-required-permissions': ['work-orders:read'],
        responses: {
          '200': {
            description:
              'Personnel from the configured adapter; creation does not depend on this lookup',
            content: success(workOrderSourcesSchema),
          },
          ...failures,
        },
      },
    },
  },
};
