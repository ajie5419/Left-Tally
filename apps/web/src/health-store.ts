import { defineStore } from 'pinia';
import { ref } from 'vue';
import { healthSchema, type Health } from '@gc/contracts';

export const useHealthStore = defineStore('health', () => {
  const result = ref<Health | null>(null);
  const loading = ref(false);
  const error = ref('');
  async function refresh() {
    loading.value = true;
    error.value = '';
    result.value = null;
    try {
      const response = await fetch('/health');
      if (!response.ok) throw new Error('健康接口未成功响应');
      const body: unknown = await response.json();
      result.value = healthSchema.parse(body);
    } catch {
      error.value = '未能确认服务状态，请检查接口后重新检测。';
    } finally {
      loading.value = false;
    }
  }
  return { result, loading, error, refresh };
});
