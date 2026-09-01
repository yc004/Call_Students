<script lang="ts" setup>
import { Button, Popover } from 'ant-design-vue';

defineOptions({ name: 'PrimaryColorPicker' });

const color = defineModel<string>({ default: '#2563EB' });
const presets = [
  '#2563EB',
  '#1677FF',
  '#0891B2',
  '#059669',
  '#16A34A',
  '#CA8A04',
  '#EA580C',
  '#DC2626',
  '#DB2777',
  '#7C3AED',
];

function handleInput(event: Event) {
  color.value = (event.target as HTMLInputElement).value.toUpperCase();
}
</script>

<template>
  <Popover placement="bottomLeft" trigger="click">
    <template #content>
      <div class="w-[230px]">
        <div class="mb-2 text-xs text-gray-500">自定义颜色</div>
        <input
          :value="color"
          aria-label="选择品牌主色"
          class="color-input"
          type="color"
          @input="handleInput"
        />
        <div class="mb-2 mt-4 text-xs text-gray-500">推荐品牌色</div>
        <div class="preset-grid">
          <button
            v-for="item in presets"
            :key="item"
            :aria-label="`选择颜色 ${item}`"
            :class="{ selected: item === color.toUpperCase() }"
            :style="{ backgroundColor: item }"
            type="button"
            @click="color = item"
          ></button>
        </div>
      </div>
    </template>
    <Button class="color-trigger">
      <span class="color-swatch" :style="{ backgroundColor: color }"></span>
      <span>{{ color.toUpperCase() }}</span>
    </Button>
  </Popover>
</template>

<style scoped>
.color-trigger {
  align-items: center;
  display: inline-flex;
  min-width: 132px;
}

.color-swatch {
  border: 1px solid rgb(0 0 0 / 12%);
  border-radius: 4px;
  display: inline-block;
  height: 20px;
  margin-right: 8px;
  width: 20px;
}

.color-input {
  background: transparent;
  border: 1px solid #d9d9d9;
  border-radius: 6px;
  cursor: pointer;
  height: 44px;
  padding: 3px;
  width: 100%;
}

.preset-grid {
  display: grid;
  gap: 8px;
  grid-template-columns: repeat(5, 1fr);
}

.preset-grid button {
  border: 2px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  height: 30px;
  outline: 1px solid rgb(0 0 0 / 10%);
}

.preset-grid button.selected {
  border-color: white;
  box-shadow: 0 0 0 2px #1677ff;
}
</style>
