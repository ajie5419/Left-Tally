import { defineStore } from 'pinia';
import {
  z,
  accountSchema,
  loginSchema,
  principalSchema,
  sessionSchema,
  workOrderSourcesSchema,
  workOrderListSchema,
  type Principal,
  type ProductionLead,
  type WorkOrder,
  type CreateWorkOrder,
} from '@gc/contracts';
import {
  workOrderRequest as request,
  WorkOrderRequestError,
} from './work-order-api';

interface WorkOrderState {
  identity: Principal | null;
  leads: ProductionLead[];
  orders: WorkOrder[];
  error: string;
  notice: string;
  loading: boolean;
  saving: boolean;
  mode: 'demo' | 'production' | null;
  loginUrl: string | null;
  identityVersion: number;
}
export const useWorkOrderStore = defineStore('work-orders', {
  state: (): WorkOrderState => ({
    identity: null,
    leads: [],
    orders: [],
    error: '',
    notice: '',
    loading: false,
    saving: false,
    mode: null,
    loginUrl: null,
    identityVersion: 0,
  }),
  actions: {
    clearIdentity() {
      this.identityVersion++;
      this.identity = null;
      this.orders = [];
      this.leads = [];
    },
    async logout() {
      this.notice = '';
      this.error = '';
      try {
        await request(
          '/auth/logout',
          z.object({ loggedOut: z.literal(true) }).strict(),
          {},
        );
        this.clearIdentity();
        this.notice = '已退出履约系统。';
      } catch {
        this.error = '无法确认会话撤销，请重试退出。';
      }
    },
    async refresh() {
      const version = this.identityVersion;
      this.error = '';
      this.loading = true;
      try {
        // Orders remain readable even when personnel lookup is temporarily unavailable.
        const orders = await request('/work-orders', workOrderListSchema);
        if (version !== this.identityVersion) return;
        this.orders = orders;
        if (this.orders.some((order) => order.productionLeadId !== null)) {
          const available = await request(
            '/work-orders/sources',
            workOrderSourcesSchema,
          );
          if (version === this.identityVersion)
            this.leads = available.productionLeads;
        }
      } catch (cause) {
        if (version !== this.identityVersion) return;
        if (
          !(cause instanceof WorkOrderRequestError) ||
          cause.unavailable ||
          [401, 403, 502, 503, 504].includes(cause.status)
        )
          this.clearIdentity();
        this.error =
          cause instanceof Error ? cause.message : '无法读取工单，请重试';
      } finally {
        this.loading = false;
      }
    },
    async initialize() {
      this.error = '';
      this.clearIdentity();
      const version = this.identityVersion;
      try {
        const session = await request('/session', sessionSchema);
        if (version !== this.identityVersion) return;
        this.mode = session.mode;
        this.loginUrl = session.loginUrl;
        this.identity = session.principal;
        if (this.identity?.permissions.includes('work-orders:read'))
          await this.refresh();
      } catch {
        if (version !== this.identityVersion) return;
        this.clearIdentity();
        this.error = '无法读取登录状态，请检查服务连接后重试。';
      }
    },
    async login(username: string, password: string) {
      this.error = '';
      this.notice = '';
      this.clearIdentity();
      const version = this.identityVersion;
      try {
        const input = loginSchema.parse({ username, password });
        const result = await request(
          '/auth/login',
          z.object({ principal: principalSchema }).strict(),
          input,
        );
        const identity = result.principal;
        if (version !== this.identityVersion) return;
        this.identity = identity;
        if (identity.permissions.includes('work-orders:read'))
          await this.refresh();
      } catch (cause) {
        if (version !== this.identityVersion) return;
        this.error =
          cause instanceof Error ? cause.message : '身份切换失败，请重试';
      }
    },
    async accounts() {
      return request('/accounts', accountSchema.array());
    },
    async createAccount(input: unknown) {
      return request('/accounts', accountSchema, input);
    },
    async updatePermissions(id: string, input: unknown) {
      return request(
        `/accounts/${id}/permissions`,
        accountSchema,
        input,
        'PUT',
      );
    },
    async resetPassword(id: string, password: string) {
      return request(`/accounts/${id}/reset-password`, accountSchema, {
        password,
      });
    },
    async updateAccountActive(id: string, active: boolean) {
      return request(
        `/accounts/${id}/active`,
        accountSchema,
        { active },
        'PUT',
      );
    },
    async create(input: CreateWorkOrder) {
      if (this.saving) return;
      this.saving = true;
      this.error = '';
      this.notice = '';
      const version = this.identityVersion;
      try {
        await request('/work-orders', z.object({ id: z.uuid() }), input);
        if (version !== this.identityVersion) return;
        this.notice = '工单已创建';
        await this.refresh();
      } catch (cause) {
        if (version !== this.identityVersion) return;
        if (
          !(cause instanceof WorkOrderRequestError) ||
          cause.unavailable ||
          [401, 403, 502, 503, 504].includes(cause.status)
        )
          this.clearIdentity();
        this.error =
          cause instanceof Error ? cause.message : '保存失败，请重试';
      } finally {
        this.saving = false;
      }
    },
  },
});
