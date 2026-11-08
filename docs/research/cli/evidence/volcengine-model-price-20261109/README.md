# Volcengine exact model pricing evidence (2026-11-09)

The official Ark pricing page lists the exact model family behind `deepseek-v4-1-flash-economy-261017`. For the economy variant it gives CNY per million tokens: idle input `0.80`, cache hit `0.016`, output `3.20`; peak input `1.60`, cache hit `0.032`, output `6.40`. The model documentation identifies `deepseek-v4-1-flash-261017` as the version and states that the economy edition uses the same weights with lower pricing.

Sources:

- https://docs.volcengine.com/docs/ark/model-pricing?lang=zh&redirect=1
- https://console.volcengine.com/ark/region:cn-beijing/docs/deepseek-v4-1-flash

This closes the official model-price lookup for the observed live model, but it does not close invoice reconciliation or paid admission. The current CLI estimator returns `matched:false` for the exact economy alias and reports USD. Because the provider price is time-windowed and CNY-denominated, this evidence is intentionally not converted into a fixed USD rate or used to claim formal settlement.
