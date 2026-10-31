import assert from "node:assert/strict";
import { selectNativeSamples } from "./verify01-native-task-campaign.mjs";
import { nativeProviderProfile } from "./verify01-native-provider-profile.mjs";

/** A fresh OpenAI cohort uses one independent host job per JetBrains sample. */
export function nativeProviderCells(
  rows,
  plan,
  sampleIds,
  provider = "volcengine",
) {
  nativeProviderProfile(provider);
  assert.ok(Array.isArray(rows) && rows.length > 0);
  assert.equal(new Set(rows.map((row) => row.group)).size, rows.length);
  if (provider === "volcengine") return rows;
  const result = rows.flatMap((row) => {
    const platform = row.group.split("-")[0];
    assert.ok(["win32", "linux", "darwin"].includes(platform));
    assert.ok(["cli", "vscode", "jetbrains"].includes(row.entry));
    assert.equal(row.group, `${platform}-${row.entry}`);
    const samples = selectNativeSamples(plan, platform, row.entry, sampleIds);
    return row.entry === "jetbrains"
      ? samples.map((sample) => ({
          ...row,
          cell_id: `${row.group}-${sample.id}`,
          sample_ids: sample.id,
          sample_count: 1,
        }))
      : [
          {
            ...row,
            cell_id: row.group,
            sample_ids: sampleIds?.join(",") || "",
            sample_count: samples.length,
          },
        ];
  });
  assert.equal(new Set(result.map((row) => row.cell_id)).size, result.length);
  return result;
}
