/**
 * GET /v1/models
 * Returns all available models across all configured providers,
 * in OpenAI-compatible format.
 */

import type { Context } from "hono";
import { registry } from "../providers/registry.js";
import type { ModelListResponse, ModelObject } from "../types/openai.js";

export function modelsHandler(c: Context): Response {
  const providers = registry.getAll();
  const seen = new Set<string>();
  const models: ModelObject[] = [];

  for (const provider of providers) {
    for (const model of provider.config.models) {
      // Add canonical model ID
      if (!seen.has(model.id)) {
        seen.add(model.id);
        models.push({
          id: model.id,
          object: "model",
          created: 1677858242,  // static timestamp
          owned_by: provider.config.name.toLowerCase().replace(/\s+/g, "-"),
        });
      }

      // Also add alias if it exists and differs from ID
      if (model.alias && !seen.has(model.alias)) {
        seen.add(model.alias);
        models.push({
          id: model.alias,
          object: "model",
          created: 1677858242,
          owned_by: provider.config.name.toLowerCase().replace(/\s+/g, "-"),
        });
      }
    }
  }

  const response: ModelListResponse = {
    object: "list",
    data: models,
  };

  return c.json(response);
}
