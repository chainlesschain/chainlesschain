<template>
  <a-card title="性能优化">
    <a-form :label-col="{ span: 6 }" :wrapper-col="{ span: 18 }">
      <a-form-item label="硬件加速">
        <a-switch v-model:checked="config.performance.hardwareAcceleration" />
        <span style="margin-left: 8px">使用 GPU 加速渲染(需重启)</span>
      </a-form-item>

      <a-form-item label="GPU 光栅化">
        <a-switch v-model:checked="config.performance.gpuRasterization" />
        <span style="margin-left: 8px">使用 GPU 进行光栅化(需重启)</span>
      </a-form-item>

      <a-form-item label="最大内存">
        <a-slider
          v-model:value="config.performance.maxMemory"
          :min="256"
          :max="2048"
          :step="256"
          :marks="{
            256: '256MB',
            512: '512MB',
            1024: '1GB',
            2048: '2GB',
          }"
        />
        <template #extra>
          当前设置: {{ config.performance.maxMemory }} MB
        </template>
      </a-form-item>

      <a-form-item label="缓存大小">
        <a-slider
          v-model:value="config.performance.cacheSize"
          :min="50"
          :max="500"
          :step="50"
          :marks="{
            50: '50MB',
            100: '100MB',
            250: '250MB',
            500: '500MB',
          }"
        />
        <template #extra>
          当前设置: {{ config.performance.cacheSize }} MB
        </template>
      </a-form-item>
    </a-form>
    <a-alert
      message="性能提示"
      description="修改性能设置后需要重启应用才能生效。如果遇到性能问题,可以尝试禁用硬件加速或减少内存限制。"
      type="warning"
      show-icon
      style="margin-top: 16px"
    />
  </a-card>
</template>

<script setup>
const config = defineModel("config", { type: Object, required: true });
</script>
