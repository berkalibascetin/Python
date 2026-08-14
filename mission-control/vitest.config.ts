import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // fixtures/ altındakiler ölçüm VERİSİDİR; onların test dosyaları golden
    // senaryonun parçasıdır ve sandbox içinde koşar. Bu suite'e dahil
    // edilirlerse kasıtlı olarak kırmızı olan fixture'lar CI'yı kırar.
    exclude: ["**/node_modules/**", "**/dist/**", "fixtures/**"],
  },
});
