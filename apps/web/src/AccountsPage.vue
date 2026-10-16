<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AButton from 'ant-design-vue/es/button';
import type { Account } from '@gc/contracts';
import { useWorkOrderStore } from './work-order-store';

const store = useWorkOrderStore();
const router = useRouter();
const accounts = ref<Account[]>([]);
const error = ref('');
const notice = ref('');
const loading = ref(false);
const savingAccounts = ref<Record<string, boolean>>({});
const permissionQueues = new Map<string, Promise<void>>();
const form = reactive({
  username: '',
  name: '',
  password: '',
  read: true,
  create: false,
  accountAdmin: false,
});

function permissions(read: boolean, create: boolean) {
  const result = new Set<Account['permissions'][number]>();
  if (read || create) result.add('work-orders:read');
  if (create) result.add('work-orders:create');
  return [...result];
}

function queueAccountSave(accountId: string, task: () => Promise<void>) {
  const current = permissionQueues.get(accountId) ?? Promise.resolve();
  const next = current.then(task, task);
  permissionQueues.set(accountId, next);
  return next;
}

async function reauthenticateIfSelf(targetId: string, message: string) {
  // Changing my own credentials revokes my sessions; privileged controls must not linger.
  if (store.identity?.id !== targetId) return;
  store.clearIdentity();
  store.notice = message;
  await router.replace('/login');
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    accounts.value = await store.accounts();
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : '无法读取账户，请重试';
    await store.initialize();
    if (!store.identity?.accountAdmin) await router.replace('/login');
  } finally {
    loading.value = false;
  }
}

async function create() {
  if (loading.value) return;
  loading.value = true;
  error.value = '';
  notice.value = '';
  try {
    await store.createAccount({
      username: form.username,
      name: form.name,
      password: form.password,
      permissions: permissions(form.read, form.create),
      accountAdmin: form.accountAdmin,
    });
    form.password = '';
    form.username = '';
    form.name = '';
    form.read = true;
    form.create = false;
    form.accountAdmin = false;
    notice.value = '账户已创建。';
    await load();
  } catch (cause) {
    form.password = '';
    error.value =
      cause instanceof Error ? cause.message : '创建账户失败，请重试';
  } finally {
    loading.value = false;
  }
}

async function savePermissions(
  account: Account,
  read: boolean,
  create: boolean,
  accountAdmin: boolean,
) {
  account.permissions = permissions(read, create);
  account.accountAdmin = accountAdmin;
  return queueAccountSave(account.id, async () => {
    savingAccounts.value[account.id] = true;
    error.value = '';
    notice.value = '';
    try {
      await store.updatePermissions(account.id, {
        permissions: account.permissions,
        accountAdmin: account.accountAdmin,
      });
      await reauthenticateIfSelf(
        account.id,
        '已更新当前登录账户的权限，请重新登录。',
      );
      notice.value = `已更新 ${account.name} 的权限；该账户需要重新登录。`;
    } catch (cause) {
      error.value =
        cause instanceof Error ? cause.message : '更新权限失败，请重试';
      await load();
    } finally {
      savingAccounts.value[account.id] = false;
    }
  });
}

async function reset(account: Account, password: string) {
  if (!password) return;
  error.value = '';
  notice.value = '';
  try {
    await store.resetPassword(account.id, password);
    await reauthenticateIfSelf(
      account.id,
      '已重置当前登录账户的密码，请重新登录。',
    );
    notice.value = `已重置 ${account.name} 的密码；该账户需要重新登录。`;
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : '重置密码失败，请重试';
  }
}

async function setActive(account: Account, active: boolean) {
  error.value = '';
  notice.value = '';
  try {
    await store.updateAccountActive(account.id, active);
    notice.value = active
      ? `已启用 ${account.name}。`
      : `已停用 ${account.name}；该账户下次操作将被拒绝。`;
    await load();
  } catch (cause) {
    error.value =
      cause instanceof Error ? cause.message : '更新账户状态失败，请重试';
  }
}

onMounted(async () => {
  await store.initialize();
  if (!store.identity?.accountAdmin) await router.replace('/login');
  else await load();
});
</script>

<template>
  <h1>账户管理</h1>
  <p class="intro">
    管理员在此开通、授权、重置密码或停用履约系统账户。操作会使该账户重新登录。
  </p>
  <p v-if="error" class="form-error" role="alert">{{ error }}</p>
  <p v-if="notice" class="saved-notice" role="status">{{ notice }}</p>
  <section class="panel" aria-labelledby="new-account-title">
    <h2 id="new-account-title">开通账户</h2>
    <form class="account-form" @submit.prevent="create">
      <label>
        账号
        <input
          v-model="form.username"
          autocomplete="username"
          required
          maxlength="64"
        />
      </label>
      <label>
        姓名
        <input
          v-model="form.name"
          autocomplete="name"
          required
          maxlength="128"
        />
      </label>
      <label>
        初始密码
        <input
          v-model="form.password"
          type="password"
          autocomplete="new-password"
          required
          minlength="12"
          maxlength="128"
        />
      </label>
      <label>
        <input v-model="form.read" type="checkbox" />
        可查看工单
      </label>
      <label>
        <input v-model="form.create" type="checkbox" />
        可新建工单（同时可查看）
      </label>
      <label>
        <input v-model="form.accountAdmin" type="checkbox" />
        可管理账户
      </label>
      <AButton
        type="primary"
        html-type="submit"
        :loading="loading"
        :disabled="loading"
      >
        创建账户
      </AButton>
    </form>
  </section>
  <section
    class="panel account-list"
    aria-labelledby="account-list-title"
    :aria-busy="loading"
  >
    <div class="panel-heading">
      <h2 id="account-list-title">现有账户</h2>
      <AButton :loading="loading" @click="load">重新读取</AButton>
    </div>
    <p v-if="!loading && !accounts.length">尚无可显示的账户。</p>
    <article v-for="account in accounts" :key="account.id" class="account-row">
      <h3>
        {{ account.name }} <span>{{ account.username }}</span>
      </h3>
      <p>状态：{{ account.active ? '启用' : '已停用' }}</p>
      <div class="account-actions">
        <label>
          <input
            :disabled="Boolean(savingAccounts[account.id])"
            :checked="account.permissions.includes('work-orders:read')"
            type="checkbox"
            @change="
              savePermissions(
                account,
                ($event.target as HTMLInputElement).checked,
                account.permissions.includes('work-orders:create'),
                account.accountAdmin,
              )
            "
          />
          查看
        </label>
        <label>
          <input
            :disabled="Boolean(savingAccounts[account.id])"
            :checked="account.permissions.includes('work-orders:create')"
            type="checkbox"
            @change="
              savePermissions(
                account,
                account.permissions.includes('work-orders:read'),
                ($event.target as HTMLInputElement).checked,
                account.accountAdmin,
              )
            "
          />
          建单
        </label>
        <label>
          <input
            :disabled="Boolean(savingAccounts[account.id])"
            :checked="account.accountAdmin"
            type="checkbox"
            @change="
              savePermissions(
                account,
                account.permissions.includes('work-orders:read'),
                account.permissions.includes('work-orders:create'),
                ($event.target as HTMLInputElement).checked,
              )
            "
          />
          账户管理
        </label>
        <label>
          新密码
          <input
            type="password"
            autocomplete="new-password"
            minlength="12"
            maxlength="128"
            @change="
              reset(account, ($event.target as HTMLInputElement).value);
              ($event.target as HTMLInputElement).value = '';
            "
          />
        </label>
        <AButton @click="setActive(account, !account.active)">
          {{ account.active ? '停用账户' : '启用账户' }}
        </AButton>
      </div>
    </article>
  </section>
</template>

<style scoped>
.account-form,
.account-actions {
  display: grid;
  gap: 12px;
  margin-top: 18px;
  max-width: 560px;
}
.account-form label {
  display: grid;
  gap: 6px;
  font-weight: 600;
}
.account-form input:not([type='checkbox']),
.account-actions input[type='password'] {
  padding: 9px;
  border: 1px solid #9db1c0;
  border-radius: 4px;
  font: inherit;
}
.account-list {
  margin-top: 22px;
}
.account-row {
  border-top: 1px solid var(--line);
  padding: 18px 0;
}
.account-row h3 {
  margin: 0;
}
.account-row h3 span {
  font-size: 14px;
  color: var(--muted);
  font-weight: 400;
}
.account-actions {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  max-width: 760px;
}
.form-error {
  color: #9e3c37;
  background: #fbece9;
  padding: 12px;
}
.saved-notice {
  color: #23694e;
}
@media (max-width: 600px) {
  .account-actions {
    grid-template-columns: 1fr;
  }
}
</style>
