export interface OwlQueryPreset {
  label: string;
  queries: readonly string[];
}

export const OWL_QUERY_PRESETS = {
  everyday: {
    label: 'Hằng ngày',
    queries: ['person', 'chair', 'laptop', 'cup']
  },
  mobility: {
    label: 'Di chuyển',
    queries: ['person', 'car', 'bus', 'bicycle', 'motorcycle']
  },
  workspace: {
    label: 'Bàn làm việc',
    queries: ['person', 'chair', 'laptop', 'cup', 'phone']
  },
  logistics: {
    label: 'Kho vận',
    queries: ['person', 'box', 'pallet', 'forklift', 'door']
  }
} as const satisfies Record<string, OwlQueryPreset>;

export type OwlQueryPresetId = keyof typeof OWL_QUERY_PRESETS;

export interface OwlPromptPlan {
  labels: string[];
  prompts: string[];
  labelByPrompt: Map<string, string>;
}

function articleFor(label: string): 'a' | 'an' {
  return /^[aeiou]/i.test(label) ? 'an' : 'a';
}

export function createOwlPromptPlan(queries: string[], maxQueries = 8): OwlPromptPlan {
  const labels = [...new Set(queries.map((query) => query.trim().toLowerCase()).filter(Boolean))].slice(0, maxQueries);
  const prompts = labels.map((label) => {
    if (/^a photo of\b/i.test(label)) return label;
    return `a photo of ${articleFor(label)} ${label}`;
  });
  return {
    labels,
    prompts,
    labelByPrompt: new Map(prompts.map((prompt, index) => [prompt, labels[index]]))
  };
}
