<script setup lang="ts">
import AButton from 'ant-design-vue/es/button';
import ATag from 'ant-design-vue/es/tag';
import { useHealthStore } from './health-store';

const health = useHealthStore();
</script>

<template>
  <h1>工程状态</h1>
  <p class="intro">基础服务与公开健康接口状态。</p>
  <section class="panel" aria-labelledby="service-title">
    <div class="panel-heading">
      <h2 id="service-title">服务连通性</h2>
      <ATag>公开端点</ATag>
    </div>
    <p role="status" aria-live="polite">
      {{ health.result ? '健康接口已响应' : '服务状态尚未确认' }}
    </p>
    <p v-if="health.error" role="alert">{{ health.error }}</p>
    <AButton type="primary" :loading="health.loading" @click="health.refresh">
      检测健康接口
    </AButton>
    <p class="footnote">
      接口响应表示基础服务可访问。健康端点保持轻量存活探测，不承载业务鉴权。
    </p>
  </section>
  <section class="scope" aria-labelledby="scope-title">
    <h2 id="scope-title">当前开放范围</h2>
    <dl>
      <div>
        <dt>公开接口</dt>
        <dd>健康状态、接口说明</dd>
      </div>
      <div>
        <dt>履约业务</dt>
        <dd>工单新建与查看（已开放）</dd>
      </div>
      <div>
        <dt>质量系统</dt>
        <dd>尚未接通</dd>
      </div>
    </dl>
  </section>
</template>
