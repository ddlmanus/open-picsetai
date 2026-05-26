export function getAgentAnalysisChatOptions(params: {
  modelId?: string
  temperature?: number
  maxTokens?: number
}) {
  return {
    model: params.modelId,
    temperature: params.temperature,
    max_tokens: params.maxTokens,
  }
}
