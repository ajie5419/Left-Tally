<script setup lang="ts">
import AButton from 'ant-design-vue/es/button';
import ATag from 'ant-design-vue/es/tag';
import { useHealthStore } from './health-store';

const health = useHealthStore();
</script>

<template>
  <h1>工程状态</h1>
  <p class="intro">当前提供基础页面和公开健康接口，正式履约能力尚未建立。</p>
  <section class="panel" aria-labelledby="service-title">
    <div class="panel-heading">
      <h2 id="service-title">服务连通性</h2>
      <ATag>初始化阶段</ATag>
    </div>
    <p role="status" aria-live="polite">
      {{ health.result ? '健康接口已响应' : '服务状态尚未确认' }}
    </p>
    <p v-if="health.error" role="alert">{{ health.error }}</p>
    <AButton type="primary" :loading="health.loading" @click="health.refresh">
      检测健康接口
    </AButton>
    <p class="footnote">
      接口响应只表示服务可访问。身份认证、数据库和 QMS 接通尚未验证。
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
        <dt>正式业务</dt>
        <dd>尚未实现</dd>
      </div>
      <div>
        <dt>质量系统</dt>
        <dd>尚未接通</dd>
      </div>
    </dl>
  </section>
</template>
