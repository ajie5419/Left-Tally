<template>
  <header class="top">
    <span class="brand">Grand Comptroller</span>
    <span class="subtitle">履约管理 · 工程初始化</span>
  </header>
  <div class="notice">工程初始化，尚无正式业务功能</div>
  <div class="shell">
    <nav aria-label="主导航">
      <RouterLink to="/" aria-current="page">工程状态</RouterLink>
      <p>业务页面将在规则与验收建立后逐步开放。</p>
    </nav>
    <main><RouterView /></main>
  </div>
</template>
