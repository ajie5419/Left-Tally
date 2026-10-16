<script setup lang="ts">
import { computed, onMounted, reactive } from 'vue';
import { useRouter } from 'vue-router';
import AButton from 'ant-design-vue/es/button';
import { createWorkOrderSchema } from '@gc/contracts';
import { useWorkOrderStore } from './work-order-store';
const store = useWorkOrderStore();
const router = useRouter();
const noPermissions = computed(
  () =>
    store.mode === 'production' &&
    store.identity !== null &&
    store.identity.permissions.length === 0,
);
const form = reactive({
  number: '',
  customer: '',
  project: '',
  division: '',
  dueDate: '',
  quantity: 1,
});
onMounted(() => {
  store
    .initialize()
    .then(() => {
      if (!store.identity) return router.replace('/login');
    })
    .catch(() => {
      store.error = '无法读取登录状态，请重试';
    });
});
function save() {
  const parsed = createWorkOrderSchema.safeParse(form);
  if (!parsed.success) {
    store.error = '请检查必填项、字段长度、有效交期及数量（每张工单为 1 台）';
    return;
  }
  store.create(parsed.data).catch(() => {
    store.error = '保存失败，请重试';
  });
}
function leadName(id: string | null) {
  if (id === null) return '待生产部指定';
  return store.leads.find((lead) => lead.id === id)?.name ?? '负责人信息待核实';
}
</script>

<template>
  <h1>工单库</h1>
  <p class="intro">
    每台设备独立建单。项目部建立工单，生产项目负责人由生产部指定。
  </p>
  <p v-if="store.identity">当前登录：{{ store.identity.name }}</p>
  <AButton
    v-if="store.identity"
    @click="
      store.logout().then(() => {
        if (!store.identity) router.replace('/login');
      })
    "
  >
    退出履约系统
  </AButton>
  <p v-if="noPermissions" role="status">
    您已登录，但尚未获得履约工单库的查看或建单权限，请联系履约系统管理员。
  </p>
  <p v-if="store.error" role="alert" class="form-error">{{ store.error }}</p>
  <AButton v-if="store.error" @click="store.initialize()">
    重新读取登录状态
  </AButton>
  <p v-if="store.notice" role="status" class="saved-notice">
    {{ store.notice }}
  </p>
  <div v-if="store.identity" class="work-order-layout">
    <section
      v-if="store.identity.permissions.includes('work-orders:read')"
      class="panel order-library"
      aria-labelledby="orders-title"
      :aria-busy="store.loading"
    >
      <div class="panel-heading">
        <h2 id="orders-title">设备工单</h2>
        <AButton :loading="store.loading" @click="store.refresh()">
          重新读取
        </AButton>
      </div>
      <p v-if="store.loading">正在读取工单…</p>
      <p v-else-if="!store.orders.length && !store.error" class="empty-orders">
        尚无工单。请为每台设备分别新建工单。
      </p>
      <p v-if="store.error && store.orders.length" class="footnote">
        读取遇到问题，以下记录请重新读取核实。
      </p>
      <ul class="order-list" aria-label="设备工单">
        <li v-for="order in store.orders" :key="order.id">
          <div class="order-title">
            <strong>{{ order.number }}</strong>
          </div>
          <dl>
            <div>
              <dt>客户名称</dt>
              <dd>{{ order.customer }}</dd>
            </div>
            <div>
              <dt>项目</dt>
              <dd>{{ order.project ?? '未填' }}</dd>
            </div>
            <div>
              <dt>事业部</dt>
              <dd>{{ order.division ?? '未填' }}</dd>
            </div>
            <div>
              <dt>数量</dt>
              <dd>{{ order.quantity }} 台</dd>
            </div>
            <div>
              <dt>交期</dt>
              <dd>{{ order.dueDate }}</dd>
            </div>
            <div>
              <dt>生产项目负责人</dt>
              <dd>{{ leadName(order.productionLeadId) }}</dd>
            </div>
          </dl>
        </li>
      </ul>
    </section>
    <section
      v-if="store.identity.permissions.includes('work-orders:create')"
      class="panel link-form"
      aria-labelledby="create-title"
    >
      <h2 id="create-title">新建工单</h2>
      <form @submit.prevent="save">
        <label for="order-number">工单号（必填）</label>
        <input
          id="order-number"
          v-model="form.number"
          maxlength="128"
          required
        />
        <label for="customer">客户名称（必填）</label>
        <input id="customer" v-model="form.customer" maxlength="200" required />
        <label for="quantity">数量（台，必填）</label>
        <input
          id="quantity"
          v-model.number="form.quantity"
          type="number"
          min="1"
          max="1"
          step="1"
          required
        />
        <p class="footnote">
          每台设备一张工单，数量为 1 台；多台设备请分别建单。
        </p>
        <label for="due-date">交期（必填）</label>
        <input id="due-date" v-model="form.dueDate" type="date" required />
        <label for="project">项目（选填）</label>
        <input id="project" v-model="form.project" maxlength="200" />
        <label for="division">事业部（选填）</label>
        <input id="division" v-model="form.division" maxlength="128" />
        <p class="footnote">建单无需指定生产项目负责人，由生产部后续指定。</p>
        <AButton
          type="primary"
          html-type="submit"
          :loading="store.saving"
          :disabled="store.loading || store.saving"
        >
          保存工单
        </AButton>
      </form>
    </section>
    <p v-else class="read-only-note">
      当前身份没有新建权限，新建操作由项目部完成。
    </p>
  </div>
  <p class="footnote">
    当前交付范围：本系统新建工单和查看。生产部指定负责人、计划协调、派工、进度及客户验收尚未开放。
  </p>
</template>

<style scoped>
input {
  width: auto;
}
.work-order-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 300px;
  gap: 20px;
  align-items: start;
}
.order-list {
  list-style: none;
  padding: 0;
  margin: 18px 0 0;
}
.order-list li + li {
  margin-top: 26px;
  border-top: 2px solid var(--line);
  padding-top: 20px;
}
.order-title {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  align-items: baseline;
}
.order-title strong {
  font-size: 20px;
  color: var(--blue);
}
dl div {
  grid-template-columns: 130px minmax(0, 1fr);
}
dd {
  overflow-wrap: anywhere;
}
label {
  display: block;
  font-weight: 600;
}
select,
input {
  width: 100%;
  max-width: 100%;
  padding: 9px;
  border: 1px solid #9db1c0;
  border-radius: 4px;
  background: white;
  color: inherit;
  font: inherit;
}
form label {
  margin-top: 20px;
  margin-bottom: 7px;
}
form button {
  margin-top: 22px;
}
.source-preview {
  font-size: 13px;
}
.source-preview div {
  grid-template-columns: 55px minmax(0, 1fr);
}
.form-error {
  color: #9e3c37;
  background: #fbece9;
  padding: 12px;
}
.saved-notice {
  color: #23694e;
}
select:focus-visible,
input:focus-visible {
  outline: 3px solid #b47b22;
  outline-offset: 3px;
}
@media (max-width: 1000px) {
  .work-order-layout {
    grid-template-columns: 1fr;
  }
}
@media (max-width: 600px) {
  input {
    width: 100%;
  }
  dl div {
    grid-template-columns: 110px minmax(0, 1fr);
  }
}
</style>
