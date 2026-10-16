<script setup lang="ts">
import { reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import AButton from 'ant-design-vue/es/button';
import { useWorkOrderStore } from './work-order-store';

const store = useWorkOrderStore();
const router = useRouter();
const form = reactive({ username: '', password: '' });
const submitting = ref(false);

async function submit() {
  if (submitting.value) return;
  submitting.value = true;
  try {
    await store.login(form.username, form.password);
    form.password = '';
    if (store.identity) await router.replace('/work-orders');
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="login-page" aria-labelledby="login-title">
    <h1 id="login-title">登录履约系统</h1>
    <p class="intro">使用履约系统账号登录后查看或新建工单。</p>
    <form class="panel login-form" @submit.prevent="submit">
      <p v-if="store.error" class="form-error" role="alert">
        {{ store.error }}
      </p>
      <label for="username">账号</label>
      <input
        id="username"
        v-model="form.username"
        autocomplete="username"
        required
        minlength="3"
        maxlength="64"
      />
      <label for="password">密码</label>
      <input
        id="password"
        v-model="form.password"
        type="password"
        autocomplete="current-password"
        required
        minlength="12"
        maxlength="128"
      />
      <AButton
        :auto-insert-space="false"
        type="primary"
        html-type="submit"
        :loading="submitting"
        :disabled="submitting"
      >
        登录
      </AButton>
    </form>
    <p class="footnote">本系统不提供自行注册或密码找回，请联系账户管理员。</p>
  </section>
</template>

<style scoped>
.login-page {
  max-width: 460px;
}
.login-form label {
  display: block;
  font-weight: 600;
  margin-top: 18px;
  margin-bottom: 7px;
}
.login-form input {
  width: 100%;
  padding: 9px;
  border: 1px solid #9db1c0;
  border-radius: 4px;
  font: inherit;
}
.login-form button {
  margin-top: 24px;
}
.form-error {
  color: #9e3c37;
  background: #fbece9;
  padding: 12px;
}
input:focus-visible {
  outline: 3px solid #b47b22;
  outline-offset: 3px;
}
</style>
