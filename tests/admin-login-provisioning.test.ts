import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import * as database from '../packages/db/src/index.js';
import { createApp } from '../apps/api/src/app.js';

const organizationId = '00000000-0000-4000-8000-000000000001';
const adminUserId = '00000000-0000-4000-8000-000000000002';
const createdUserId = '00000000-0000-4000-8000-000000000003';
const config = {
  supabaseUrl: 'https://example.supabase.co',
  anonKey: 'public-test-key',
  serviceRoleKey: 'private-test-key',
};

function mockAuthenticatedDb(platformRole: 'admin' | 'client') {
  return {
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: adminUserId, email: 'admin@example.test' } },
        error: null,
      }),
    },
    from: (table: string) => {
      const query: any = {
        select: vi.fn(() => query),
        eq: vi.fn(() => query),
        maybeSingle: vi.fn(async () => {
          if (table === 'profiles') {
            return {
              data: {
                role: platformRole,
                status: 'active',
                default_organization_id: organizationId,
              },
              error: null,
            };
          }
          if (table === 'organization_members') {
            return { data: { role: 'owner' }, error: null };
          }
          if (table === 'organizations') {
            return { data: { tier: 'pre-venda' }, error: null };
          }
          return { data: null, error: null };
        }),
      };
      return query;
    },
  } as unknown as database.UserDatabase;
}

afterEach(() => vi.restoreAllMocks());

describe('Admin login provisioning', () => {
  it('creates a confirmed login scoped to the selected organization without touching its plan', async () => {
    vi.spyOn(database, 'userDatabase').mockReturnValue(mockAuthenticatedDb('admin'));
    const createUser = vi.fn().mockResolvedValue({
      data: { user: { id: createdUserId, email: 'cliente@example.test' } },
      error: null,
    });
    vi.spyOn(database, 'serviceDatabase').mockReturnValue({
      auth: { admin: { createUser } },
    } as unknown as ReturnType<typeof database.serviceDatabase>);

    const response = await request(createApp(config))
      .post(`/api/admin/organizations/${organizationId}/logins`)
      .auth('valid-token', { type: 'bearer' })
      .send({
        displayName: 'Cliente Teste',
        email: 'CLIENTE@example.test',
        password: 'senha-segura-123',
        accountRole: 'client',
        memberRole: 'agent',
      });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      userId: createdUserId,
      email: 'cliente@example.test',
      organizationId,
      accountRole: 'client',
      memberRole: 'agent',
    });
    expect(response.body).not.toHaveProperty('orgTier');
    expect(createUser).toHaveBeenCalledWith({
      email: 'cliente@example.test',
      password: 'senha-segura-123',
      email_confirm: true,
      user_metadata: { display_name: 'Cliente Teste' },
      app_metadata: {
        sdr_target_organization_id: organizationId,
        sdr_member_role: 'agent',
        sdr_app_role: 'client',
        sdr_provisioned_by: adminUserId,
      },
    });
  });

  it('rejects a plan sent with the login: plans change only through billing or an audited grant', async () => {
    vi.spyOn(database, 'userDatabase').mockReturnValue(mockAuthenticatedDb('admin'));
    const serviceSpy = vi.spyOn(database, 'serviceDatabase');
    const response = await request(createApp(config))
      .post(`/api/admin/organizations/${organizationId}/logins`)
      .auth('valid-token', { type: 'bearer' })
      .send({ displayName: 'Cliente', email: 'c@example.test', password: 'senha-segura-123', memberRole: 'agent', orgTier: 'vendedor-senior' });
    expect(response.status).toBe(400);
    expect(serviceSpy).not.toHaveBeenCalled();
  });

  it('does not expose account creation to a regular client', async () => {
    vi.spyOn(database, 'userDatabase').mockReturnValue(mockAuthenticatedDb('client'));
    const serviceSpy = vi.spyOn(database, 'serviceDatabase');

    const response = await request(createApp(config))
      .post(`/api/admin/organizations/${organizationId}/logins`)
      .auth('valid-token', { type: 'bearer' })
      .send({
        displayName: 'Tentativa',
        email: 'tentativa@example.test',
        password: 'senha-segura-123',
        accountRole: 'admin',
        memberRole: 'owner',
      });

    expect(response.status).toBe(404);
    expect(serviceSpy).not.toHaveBeenCalled();
  });
});
