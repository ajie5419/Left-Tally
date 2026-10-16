<template>
  <header class="top">
    <span class="brand">Grand Comptroller</span>
    <span class="subtitle">履约管理</span>
  </header>
  <div class="notice">当前开放：工单新建与查看</div>
  <div class="shell">
    <nav aria-label="主导航">
      <RouterLink to="/work-orders">工单库</RouterLink>
      <RouterLink v-if="store.identity?.accountAdmin" to="/accounts">
        账户管理
      </RouterLink>
      <p>工单在本系统新建和保存；生产项目负责人由生产部指定。</p>
    </nav>
    <main><RouterView /></main>
  </div>
</template>
<script setup lang="ts">
import { useWorkOrderStore } from './work-order-store';
const store = useWorkOrderStore();
</script>
