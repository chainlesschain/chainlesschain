<template>
  <div class="simple-test-page">
    <h1>Simple Test Page</h1>
    <p>This is a very simple test page with no dependencies.</p>
    <div id="test-marker">TEST_MARKER_FOR_E2E</div>
  </div>
</template>

<script>
export default {
  name: 'SimpleTestPage',
};
</script>

<style scoped>
.simple-test-page {
  padding: 40px;
  background: white;
}

h1 {
  color: #1890ff;
}

#test-marker {
  margin-top: 20px;
  padding: 10px;
  background: #f0f0f0;
  border: 2px solid #1890ff;
}
</style>
